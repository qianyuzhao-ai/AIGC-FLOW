import {
  clampImageConfig,
  clampVideoConfig,
  type GenerateImageRequest,
  type GenerateVideoRequest,
  gptSizeOf,
  imageModelOf,
  videoVersionOf,
} from "@aigc-flow/shared";
import { Agent, fetch as undiciFetch } from "undici";
import { db } from "../db";
import { generations } from "../db/schema";
import { getAppSettings } from "../db/settings";
import { fetchFailureOf, isConnectFailure, messageOf, snippet } from "./upstream";

/** 内网 /aigc 的返回结构 */
type AigcResponse = {
  result?: {
    content?: string[];
    status?: string;
    error?: Record<string, unknown>;
  };
};

/**
 * 转发生成请求专用的连接配置。内网 /aigc 是同步阻塞式的，发出后一直等到生成完成
 * 才返回，受算力影响单次可能长达 10-30 分钟。Node 自带 fetch 底层是 undici，
 * 默认 headersTimeout / bodyTimeout 都是 300 秒：5 分钟没等到响应头就抛
 * `fetch failed`（cause 是 HeadersTimeoutError），之前被一律当成「连不上内网」报出去，
 * 表现就是「配置和网络都正常，慢一点的生成却偶发连不上」。
 * 这里两个等待超时都关掉（0 = 不限），只保留建连超时：真连不上还是要快点报。
 */
const aigcAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0, connectTimeout: 10_000 });

/** 转发到内网 /aigc 并取出结果地址 */
async function callAigc(
  endpoint: string,
  payload: Record<string, unknown>,
): Promise<{ url: string } | { message: string; unknown?: boolean }> {
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    // 用 undici 自己的 fetch 而不是全局 fetch：dispatcher 要和 fetch 来自同一份 undici
    res = await undiciFetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      dispatcher: aigcAgent,
    });
  } catch (error) {
    const { code, detail } = fetchFailureOf(error);
    console.error("[generate] fetch failed", code || "(no code)", detail);
    if (isConnectFailure(code, detail)) {
      return { message: "连不上内网生成服务，确认在内网环境且地址配置正确" };
    }
    // 连上了但没等到完整响应（对端断开、中途网络抖动等），把原因如实带出去
    return {
      message: `等待内网生成服务返回时中断（${code}${detail ? `：${detail}` : ""}）`,
      unknown: true,
    };
  }

  if (!res.ok) {
    // 非 200 时把响应体带出来，别让用户只看到一个状态码
    const text = snippet(await res.text().catch(() => ""));
    return { message: `内网生成服务返回 ${res.status}${text ? `：${text}` : ""}` };
  }

  const body = (await res.json().catch(() => null)) as AigcResponse | null;
  const url = body?.result?.content?.[0];
  if (body?.result?.status !== "success" || !url) {
    console.error("[generate] bad response", JSON.stringify(body));
    const detail = errorDetailOf(body?.result?.error);
    return { message: detail ? `生成失败：${detail}` : "生成失败，内网服务未返回有效结果" };
  }
  return { url };
}

/** 把内网返回的 result.error 提炼成一句人能读的话，透传给前端和流水表 */
function errorDetailOf(error: unknown): string {
  const detail = messageOf(error);
  if (detail) return detail;
  if (!error) return "";
  if (typeof error === "object") {
    const serialized = JSON.stringify(error);
    return serialized === "{}" ? "" : snippet(serialized);
  }
  return String(error);
}

/** 记一条生成流水（成功失败都记），按项目归属，统计面板和成本核算用 */
function recordGeneration(
  projectId: number,
  kind: "image" | "video",
  payload: Record<string, unknown>,
  outcome: { url: string } | { message: string },
  durationSeconds?: number,
) {
  db.insert(generations)
    .values({
      projectId,
      kind,
      payload: JSON.stringify(payload),
      status: "url" in outcome ? "success" : "error",
      error: "message" in outcome ? outcome.message : null,
      resultUrl: "url" in outcome ? outcome.url : null,
      durationSeconds: durationSeconds ?? null,
    })
    .run();
}

export async function generateImage(raw: GenerateImageRequest) {
  const input = clampImageConfig(raw);
  const { generateUrl, reqFrom } = getAppSettings();
  if (!reqFrom || !generateUrl) return { message: "请先配置内网生成接口和 req_from" };
  const model = imageModelOf(input.model);
  const config =
    model.family === "gpt"
      ? { size: gptSizeOf(input.sizePreset).size, n: 1, quality: input.quality }
      : { aspect_ratio: input.aspectRatio, image_size: input.imageSize };
  const payload = {
    req_from: reqFrom,
    model_name: model.modelName,
    version: model.version,
    prompt: input.prompt,
    image_list: input.imageList,
    config,
  };
  const outcome = await callAigc(generateUrl, payload);
  recordGeneration(input.projectId, "image", payload, outcome);
  return outcome;
}
export async function generateVideo(raw: GenerateVideoRequest) {
  const input = clampVideoConfig(raw);
  const { generateUrl, reqFrom } = getAppSettings();
  if (!reqFrom || !generateUrl) return { message: "请先配置内网生成接口和 req_from" };
  const payload = {
    req_from: reqFrom,
    model_name: "seedance",
    version: videoVersionOf(input.version).apiVersion,
    mode: input.mode,
    prompt: input.prompt,
    image_list: input.imageList,
    video_list: input.videoList,
    audio_list: input.audioList,
    config: {
      resolution: input.resolution,
      ratio: input.ratio,
      duration: input.duration,
      generate_audio: input.generateAudio,
    },
  };
  const outcome = await callAigc(generateUrl, payload);
  recordGeneration(input.projectId, "video", payload, outcome, input.duration);
  return outcome;
}
