import {
  type GenerationJobRequest,
  generateImageRequestSchema,
  generateVideoRequestSchema,
  IMAGE_GEN_NODE_TYPE,
  imageGenNodeDataSchema,
  MAX_AUDIO_REFS,
  MAX_FRAME_IMAGES,
  MAX_REFERENCE_IMAGES,
  MAX_VIDEO_REFS,
  MEDIA_TOKEN_RE,
  type MediaRefLists,
  resolveMediaRefs,
  resolvePromptText,
  TEXT_NODE_TYPE,
  TEXT_TOKEN_RE,
  VIDEO_GEN_NODE_TYPE,
  videoGenNodeDataSchema,
} from "@aigc-flow/shared";
import { nodeMediaOf } from "../node-media";
import type { CanvasState } from "./canvas-tools";
export function generationRequest(
  state: CanvasState,
  nodeId: string,
  requestId: string,
): GenerationJobRequest {
  const node = state.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error("生成节点已不存在");
  const sources = state.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => state.nodes.find((item) => item.id === edge.source));
  if (sources.some((source) => !source)) throw new Error("参考节点不存在");
  const lists: { [K in keyof MediaRefLists]: { id: string; url: string }[] } = {
    image: [],
    video: [],
    audio: [],
  };
  const texts = new Map<string, string>();
  for (const source of sources) {
    if (!source) continue;
    if (source.type === TEXT_NODE_TYPE) {
      texts.set(source.id, String(source.data.text ?? ""));
      continue;
    }
    const media = nodeMediaOf(source);
    if (!media || source.data.status !== "ready")
      throw new Error(`参考素材 ${source.data.label ?? source.id} 尚未就绪`);
    if (!lists[media.kind].some((item) => item.id === source.id))
      lists[media.kind].push({ id: source.id, url: media.url });
  }
  const raw = String(node.data.prompt ?? "");
  for (const match of raw.matchAll(TEXT_TOKEN_RE)) {
    if (!texts.has(match[1] ?? "")) throw new Error("提示词引用了未连接的文本节点");
  }
  for (const match of raw.matchAll(MEDIA_TOKEN_RE)) {
    if (!Object.values(lists).some((items) => items.some((item) => item.id === match[2])))
      throw new Error("提示词引用了未连接或未就绪的素材");
  }
  const prompt = resolveMediaRefs(resolvePromptText(raw, texts), lists);
  const urls = {
    imageList: lists.image.map((item) => item.url),
    videoList: lists.video.map((item) => item.url),
    audioList: lists.audio.map((item) => item.url),
  };
  if (node.type === IMAGE_GEN_NODE_TYPE) {
    if (lists.image.length > MAX_REFERENCE_IMAGES || lists.video.length || lists.audio.length)
      throw new Error("图像参考素材超过限制或类型不支持");
    const config = imageGenNodeDataSchema.parse(node.data);
    return {
      kind: "image",
      nodeId,
      requestId,
      input: generateImageRequestSchema
        .omit({ projectId: true })
        .parse({ ...config, prompt, imageList: urls.imageList }),
    };
  }
  if (node.type === VIDEO_GEN_NODE_TYPE) {
    const config = videoGenNodeDataSchema.parse(node.data);
    const frames = config.mode === "first_last_frame";
    if (
      lists.image.length > (frames ? MAX_FRAME_IMAGES : MAX_REFERENCE_IMAGES) ||
      lists.video.length > (frames ? 0 : MAX_VIDEO_REFS) ||
      lists.audio.length > MAX_AUDIO_REFS
    )
      throw new Error("视频参考素材超过当前模式的限制");
    return {
      kind: "video",
      nodeId,
      requestId,
      input: generateVideoRequestSchema
        .omit({ projectId: true })
        .parse({ ...config, prompt, ...urls }),
    };
  }
  throw new Error("这个节点不支持生成");
}
