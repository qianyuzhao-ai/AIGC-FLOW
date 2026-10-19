import {
  IMAGE_GEN_NODE_TYPE,
  MEDIA_NODE_TYPE,
  type PiImageAttachment,
  projectGraphSchema,
} from "@aigc-flow/shared";
import type { ImageContent } from "@earendil-works/pi-ai";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { projects } from "../db/schema";
import { isAllowedMediaSource } from "../lib/media-source";
import { getPiRuntime } from "./runtime";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function selectedImages(projectId: number, nodeIds: string[]): PiImageAttachment[] {
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new Error("项目不存在");
  const graph = projectGraphSchema.parse(JSON.parse(project.graph));
  return [...new Set(nodeIds)].map((nodeId) => {
    const node = graph.nodes.find((item) => item.id === nodeId);
    const url =
      node?.data.status === "ready"
        ? node.type === IMAGE_GEN_NODE_TYPE
          ? node.data.resultUrl
          : node.type === MEDIA_NODE_TYPE && node.data.kind === "image"
            ? node.data.url
            : undefined
        : undefined;
    if (typeof url !== "string" || !isAllowedMediaSource(url))
      throw new Error(`图片 ${node?.data.label ?? nodeId} 不可用，请重新选择已就绪的画布图片`);
    return { nodeId, label: node?.data.label ?? nodeId, url };
  });
}

function imageMime(bytes: Buffer) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP")
    return "image/webp";
  throw new Error("只支持 PNG、JPEG、WebP、GIF 图片，不能将视频或其他文件作为图片发送");
}

export async function loadImages(attachments: PiImageAttachment[], signal?: AbortSignal) {
  const images: ImageContent[] = [];
  let total = 0;
  const timeout = AbortSignal.timeout(30_000);
  for (const attachment of attachments) {
    const response = await fetch(attachment.url, {
      redirect: "error",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok || !response.body) throw new Error(`无法读取图片「${attachment.label}」`);
    const reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        total += value.length;
        if (size > MAX_IMAGE_BYTES || total > MAX_TOTAL_BYTES) {
          await reader.cancel();
          throw new Error("图片过大：单张最多 10 MB，每次合计最多 20 MB");
        }
        parts.push(value);
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = Buffer.concat(parts);
    const { sdk } = await getPiRuntime();
    const normalized = await sdk.resizeImage(bytes, imageMime(bytes));
    if (!normalized)
      throw new Error(`图片「${attachment.label}」无法解码或超过模型图片限制，请更换图片`);
    images.push({ type: "image", data: normalized.data, mimeType: normalized.mimeType });
  }
  return images;
}
