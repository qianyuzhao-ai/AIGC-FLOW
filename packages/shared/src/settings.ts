import { z } from "zod";

/**
 * 三个内网接口的完整地址没有默认值：内网地址不进仓库，
 * 首次启动后在设置面板里填（存 settings 表），没填之前上传和生成都会被服务端拒绝。
 */
export const DEFAULT_IMAGE_UPLOAD_URL = "";
export const DEFAULT_AUDIO_UPLOAD_URL = "";
export const DEFAULT_GENERATE_URL = "";

const endpointSchema = z
  .url({ protocol: /^https?$/, error: "请输入 http(s) 开头的完整地址" })
  .transform((value) => value.replace(/\/+$/, ""));

/** 全局设置。都存服务端 settings 表，设置面板可改 */
export const appSettingsSchema = z.object({
  /** 图像 / 视频上传接口的完整地址 */
  imageUploadUrl: endpointSchema,
  /** 音频上传接口的完整地址 */
  audioUploadUrl: endpointSchema,
  /** AIGC 生成接口（/aigc）的完整地址 */
  generateUrl: endpointSchema,
  /** 内网生产接口要求的请求来源标识（如 v_zhangsan）。上传和生成都要带 */
  reqFrom: z.string().trim().max(100),
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  imageUploadUrl: DEFAULT_IMAGE_UPLOAD_URL,
  audioUploadUrl: DEFAULT_AUDIO_UPLOAD_URL,
  generateUrl: DEFAULT_GENERATE_URL,
  reqFrom: "",
};
