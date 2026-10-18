import { z } from "zod";

export const piConnectionSchema = z
  .object({
    provider: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9][a-z0-9_-]*$/),
    model: z.string().trim().min(1, "请选择或填写模型").max(200),
    apiKey: z
      .string()
      .trim()
      .max(2000)
      .refine((value) => !value.startsWith("!"), {
        message: "请输入 API Key，不能在此填写命令",
      })
      .default(""),
    clearApiKey: z.boolean().default(false),
    custom: z
      .object({
        baseUrl: z.url({ protocol: /^https?$/, error: "请输入完整的 HTTP(S) 地址" }),
        api: z.enum(["openai-completions", "openai-responses", "anthropic-messages"]),
        contextWindow: z.number().int().positive().max(10_000_000),
        maxTokens: z.number().int().positive().max(1_000_000),
      })
      .refine((value) => value.maxTokens <= value.contextWindow, {
        message: "输出上限不能超过上下文长度",
      })
      .optional(),
  })
  .refine((value) => !(value.apiKey && value.clearApiKey), {
    message: "填写新 Key 和清除 Key 不能同时进行",
  });

export type PiConnection = z.infer<typeof piConnectionSchema>;
export type PiProviderView = {
  id: string;
  name: string;
  configured: boolean;
  models: { id: string; name: string }[];
};
export type PiConfiguration = {
  providers: PiProviderView[];
  provider: string;
  model: string;
};

export const piPromptSchema = z.object({
  message: z.string().trim().min(1).max(32_000),
});
export const piChatMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});
export const piChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("done"), messages: z.array(piChatMessageSchema) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type PiChatMessage = z.infer<typeof piChatMessageSchema>;
export type PiChatEvent = z.infer<typeof piChatEventSchema>;
