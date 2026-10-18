import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import {
  type PiConfiguration,
  type PiConnection,
  type PiModelsRequest,
  piCustomEndpointSchema,
} from "@aigc-flow/shared";
import { z } from "zod";
import { getPiRuntime, modelsPath } from "./runtime";

const modelFileSchema = z.looseObject({
  providers: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

async function readModelFile() {
  try {
    return modelFileSchema.parse(JSON.parse(await readFile(modelsPath, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return modelFileSchema.parse({});
    }
    throw error;
  }
}

export async function getPiConfiguration(): Promise<PiConfiguration> {
  const { models, settings } = await getPiRuntime();
  const config = await readModelFile();
  return {
    provider: settings.getDefaultProvider() ?? "",
    model: settings.getDefaultModel() ?? "",
    providers: models
      .getProviders()
      .map((provider) => {
        const custom = piCustomEndpointSchema.safeParse(config.providers[provider.id]);
        return {
          id: provider.id,
          name: provider.name,
          configured: models.hasConfiguredAuth(provider.id),
          ...(provider.id.startsWith("custom-") && custom.success ? { custom: custom.data } : {}),
          models: models.getModels(provider.id).map(({ id, name, contextWindow, maxTokens }) => ({
            id,
            name,
            contextWindow,
            maxTokens,
          })),
        };
      })
      .filter((provider) => provider.models.length > 0)
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

async function saveConnection(input: PiConnection) {
  const { models, settings } = await getPiRuntime();
  if (input.custom) {
    if (!input.provider.startsWith("custom-")) {
      throw new Error("自定义服务的标识必须以 custom- 开头");
    }
    const config = await readModelFile();
    const previous = config.providers[input.provider];
    if (
      piCustomEndpointSchema.safeParse(previous).data?.baseUrl !== input.custom.baseUrl &&
      models.hasConfiguredAuth(input.provider) &&
      !input.apiKey &&
      !input.clearApiKey
    ) {
      throw new Error("更换服务地址时，请填写新 Key 或明确清除旧 Key");
    }
    const { baseUrl, api, contextWindow, maxTokens } = input.custom;
    const existingModels = z.array(z.looseObject({ id: z.string() })).parse(previous?.models ?? []);
    config.providers[input.provider] = {
      ...previous,
      name: input.custom.name ?? previous?.name ?? input.provider,
      baseUrl,
      api,
      models: [
        ...existingModels.filter((model) => model.id !== input.model),
        {
          ...existingModels.find((model) => model.id === input.model),
          id: input.model,
          contextWindow,
          maxTokens,
        },
      ],
    };
    const temporaryPath = `${modelsPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, modelsPath);
    await models.refresh({ allowNetwork: false });
    const error = models.getError();
    if (error) throw new Error(error);
  }
  if (!models.getModel(input.provider, input.model)) {
    throw new Error("Pi 中找不到这个模型，请选择列表中的模型或添加自定义服务");
  }
  if (input.clearApiKey) await models.logout(input.provider);
  if (input.apiKey) {
    await models.login(input.provider, "api_key", {
      prompt: async (prompt) => {
        if (prompt.type !== "secret")
          throw new Error("这个服务需要额外认证信息，请使用 Pi 配置文件");
        return input.apiKey;
      },
      notify: () => {},
    });
  } else if (input.custom && !models.hasConfiguredAuth(input.provider)) {
    // Pi 的兼容服务需要一个凭据标记，无鉴权的本地服务会忽略该值。
    await models.login(input.provider, "api_key", {
      prompt: async () => "local-no-auth",
      notify: () => {},
    });
  }
  settings.setDefaultModelAndProvider(input.provider, input.model);
  await settings.flush();
  const error = settings.drainErrors()[0];
  if (error) throw error.error;
  return getPiConfiguration();
}

let saving: Promise<unknown> = Promise.resolve();

export function savePiConfiguration(input: PiConnection) {
  return serializeConfiguration(() => saveConnection(input));
}

function serializeConfiguration<T>(operation: () => Promise<T>): Promise<T> {
  const next = saving.then(operation);
  saving = next.catch(() => {});
  return next;
}

export function resolveModelsApiKey(input: PiModelsRequest, signal: AbortSignal) {
  return serializeConfiguration(async () => {
    if (input.apiKey) return input.apiKey;
    if (input.clearApiKey) return undefined;
    const { models } = await getPiRuntime();
    if (!models.hasConfiguredAuth(input.provider)) return undefined;
    const config = await readModelFile();
    const stored = piCustomEndpointSchema.safeParse(config.providers[input.provider]);
    if (!stored.success || stored.data.baseUrl !== input.baseUrl) {
      throw new Error("读取新地址的模型列表时，请填写该地址的 Key，不能沿用其他地址的凭据");
    }
    return (await models.getAuth(input.provider, { signal }))?.auth.apiKey;
  });
}

export async function getConfiguredModel() {
  const { models, settings } = await getPiRuntime();
  const provider = settings.getDefaultProvider();
  const modelId = settings.getDefaultModel();
  const model = provider && modelId ? models.getModel(provider, modelId) : undefined;
  if (!model) throw new Error("请先在设置的 Pi 模型中选择并保存模型");
  if (!models.hasConfiguredAuth(model.provider)) throw new Error("这个服务尚未配置凭据");
  return model;
}
