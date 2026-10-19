import {
  MAX_FILE_SIZE,
  MAX_FILES_PER_UPLOAD,
  mediaKindOf,
  type UploadedFile,
} from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getAppSettings } from "../db/settings";
import { isAllowedMediaSource } from "../lib/media-source";
import { storeFile } from "../uploads/storage";

const downloadQuerySchema = z.object({
  url: z.url(),
  filename: z.string().min(1).max(255),
});

function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

export const uploadsRoute = new Hono()
  .post("/", async (c) => {
    // 内网上传接口和 /aigc 一样要求 req_from。没配就别读文件了，直接挡在门口，
    // 否则整批文件白读进内存，还只能拿到内网返回的原始报错。
    const settings = getAppSettings();
    if (!settings.reqFrom) {
      return c.json({ message: "请先在设置面板填写请求来源标识（req_from）" }, 400);
    }

    // Hono 的 parseBody 会把整个文件读进内存，所以 shared 里对单文件大小做了上限
    const body = await c.req.parseBody({ all: true });
    const raw = body.file ?? body.files;
    const files = (Array.isArray(raw) ? raw : [raw]).filter(
      (item): item is File => item instanceof File,
    );

    if (files.length === 0) {
      return c.json({ message: "没有收到文件，字段名应为 file" }, 400);
    }
    if (files.length > MAX_FILES_PER_UPLOAD) {
      return c.json({ message: `一次最多上传 ${MAX_FILES_PER_UPLOAD} 个文件` }, 400);
    }

    // 逐个处理并各自捕获：一个文件失败不该让整批都失败
    const results = await Promise.all(
      files.map(async (file): Promise<UploadedFile> => {
        const kind = mediaKindOf(file.type, file.name);
        if (!kind) {
          return {
            filename: file.name,
            url: "",
            status: "error",
            error: `不支持的文件类型：${file.type || "未知"}`,
          };
        }
        if (file.size > MAX_FILE_SIZE[kind]) {
          return {
            filename: file.name,
            url: "",
            status: "error",
            error: `文件超过 ${formatSize(MAX_FILE_SIZE[kind])} 上限`,
          };
        }

        try {
          return await storeFile(file, kind, settings);
        } catch (error) {
          console.error("[upload]", file.name, error);
          return {
            filename: file.name,
            url: "",
            status: "error",
            error: error instanceof Error ? error.message : "上传失败",
          };
        }
      }),
    );

    return c.json({ files: results, success: results.every((item) => item.status !== "error") });
  })
  /**
   * 批量下载用的转发。浏览器不直连 bcebos 素材地址（跨域 + 没有
   * Content-Disposition，触发不了存盘）。统一从这里取回再带
   * Content-Disposition 吐出去，前端一个 <a> 就能触发下载。
   */
  .get("/download", zValidator("query", downloadQuerySchema), async (c) => {
    const { url, filename } = c.req.valid("query");

    if (!isAllowedMediaSource(url)) {
      return c.json({ message: "只允许下载本服务托管的素材" }, 400);
    }

    const upstream = await fetch(url);
    if (!upstream.ok || !upstream.body) {
      return c.json({ message: `源文件取不到（${upstream.status}）` }, 502);
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
        // 文件名可能是中文，必须走 RFC 5987 的 filename*，纯 filename 会被截断成乱码
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      },
    });
  });
