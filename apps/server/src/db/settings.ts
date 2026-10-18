import { type AppSettings, DEFAULT_APP_SETTINGS } from "@aigc-flow/shared";
import { db } from "./index";
import { settings } from "./schema";

/** AppSettings 字段 → settings 表 key 的映射，新增设置项在这里登记 */
const SETTING_KEYS: Record<keyof AppSettings, string> = {
  imageUploadUrl: "image_upload_url",
  audioUploadUrl: "audio_upload_url",
  generateUrl: "generate_url",
  reqFrom: "req_from",
};

/** 和 schema.ts 的 isoNow 同格式（带 Z 的 ISO 8601 UTC） */
function nowIso(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

/**
 * 全部设置。没配置过的项退回默认值。
 * 旧版存的是两个根地址（upload_base_url / generate_base_url，端点 path 写死在
 * 代码里），这里做一次读取兼容：新 key 缺失时由旧 key 拼出完整地址，
 * 下次保存就落到新 key 上。
 */
export function getAppSettings(): AppSettings {
  const rows = db.select({ key: settings.key, value: settings.value }).from(settings).all();
  const stored = new Map(rows.map((row) => [row.key, row.value]));

  const legacyUpload = stored.get("upload_base_url")?.replace(/\/+$/, "");
  const legacyGenerate = stored.get("generate_base_url")?.replace(/\/+$/, "");

  return {
    imageUploadUrl:
      stored.get(SETTING_KEYS.imageUploadUrl) ??
      (legacyUpload ? `${legacyUpload}/api/upload` : DEFAULT_APP_SETTINGS.imageUploadUrl),
    audioUploadUrl:
      stored.get(SETTING_KEYS.audioUploadUrl) ??
      (legacyUpload ? `${legacyUpload}/api/upload-media` : DEFAULT_APP_SETTINGS.audioUploadUrl),
    generateUrl:
      stored.get(SETTING_KEYS.generateUrl) ??
      (legacyGenerate ? `${legacyGenerate}/aigc` : DEFAULT_APP_SETTINGS.generateUrl),
    reqFrom: stored.get(SETTING_KEYS.reqFrom) ?? DEFAULT_APP_SETTINGS.reqFrom,
  };
}

export function setAppSettings(value: AppSettings): void {
  for (const field of Object.keys(SETTING_KEYS) as (keyof AppSettings)[]) {
    db.insert(settings)
      .values({ key: SETTING_KEYS[field], value: value[field], updatedAt: nowIso() })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value: value[field], updatedAt: nowIso() },
      })
      .run();
  }
}
