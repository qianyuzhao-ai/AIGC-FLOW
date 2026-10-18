import type { PiModelOption, PiModelsRequest } from "@aigc-flow/shared";
import { z } from "zod";
import { resolveModelsApiKey } from "./configuration";

const modelSchema = z.object({
  id: z.string().trim().min(1).max(200),
  name: z.string().nullish(),
  display_name: z.string().nullish(),
});
const modelsResponseSchema = z.object({ data: z.array(z.unknown()) });

export async function discoverPiModels(input: PiModelsRequest, requestSignal: AbortSignal) {
  const signal = AbortSignal.any([requestSignal, AbortSignal.timeout(15_000)]);
  const apiKey = await resolveModelsApiKey(input, signal);
  let response: Response;
  try {
    response = await fetch(`${input.baseUrl}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: "error",
      signal,
    });
  } catch {
    if (signal.aborted) throw new Error("读取模型列表已取消或超时，请重试，也可以手动填写模型 ID");
    throw new Error("无法读取模型列表，请检查基础地址和网络；地址需要直接指向 API 服务");
  }
  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? "请检查该聚合服务的 API Key"
        : "请检查基础地址；服务没有模型列表接口时可手动填写模型 ID";
    throw new Error(`读取模型列表失败（HTTP ${response.status}），${hint}`);
  }
  const parsed = modelsResponseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("服务未返回兼容的模型列表，可手动填写模型 ID");
  const models = new Map<string, PiModelOption>();
  for (const entry of parsed.data.data) {
    const result = modelSchema.safeParse(entry);
    if (!result.success || models.has(result.data.id)) continue;
    const { id, name, display_name: displayName } = result.data;
    models.set(id, { id, name: name || displayName || id });
  }
  if (models.size === 0) throw new Error("模型列表为空，可检查 Key 权限或手动填写模型 ID");
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
