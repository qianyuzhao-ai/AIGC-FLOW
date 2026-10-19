import { z } from "zod";
import { agentCommandViewSchema, agentRunViewSchema } from "./agent";

const providerIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const apiKeySchema = z
  .string()
  .trim()
  .max(2000)
  .refine((value) => !value.startsWith("!"), {
    message: "请输入 API Key，不能在此填写命令",
  });
export const piEndpointSchema = z
  .url({ protocol: /^https?$/, error: "请输入完整的 HTTP(S) 地址" })
  .trim()
  .refine((value) => !/[?#]/.test(value) && !/^https?:\/\/[^/]*@/i.test(value), {
    message: "基础地址不能包含账号、密码、查询参数或锚点",
  })
  .transform((value) => value.replace(/\/+$/, ""));
export const piCustomEndpointSchema = z.object({
  baseUrl: piEndpointSchema,
  api: z.enum(["openai-completions", "openai-responses", "anthropic-messages"]),
});
export const piModelsRequestSchema = z.object({
  provider: providerIdSchema,
  baseUrl: piEndpointSchema,
  apiKey: apiKeySchema.default(""),
  clearApiKey: z.boolean().default(false),
});
export type PiModelsRequest = z.infer<typeof piModelsRequestSchema>;
export type PiModelOption = { id: string; name: string };

export const piConnectionSchema = z
  .object({
    provider: providerIdSchema,
    model: z.string().trim().min(1, "请选择或填写模型").max(200),
    apiKey: apiKeySchema.default(""),
    clearApiKey: z.boolean().default(false),
    custom: piCustomEndpointSchema
      .extend({
        name: z.string().trim().min(1, "请填写服务名称").max(100).optional(),
        contextWindow: z.number().int().positive().max(10_000_000),
        maxTokens: z.number().int().positive().max(1_000_000),
        input: z
          .array(z.enum(["text", "image"]))
          .min(1)
          .default(["text"]),
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
  custom?: z.infer<typeof piCustomEndpointSchema>;
  models: (PiModelOption & { contextWindow: number; maxTokens: number; input: string[] })[];
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
  runId: z.string().optional(),
  error: z.string().nullable().optional(),
  attachments: z
    .array(z.object({ nodeId: z.string(), label: z.string(), url: z.string() }))
    .default([]),
  commands: z.array(agentCommandViewSchema).default([]),
});
export const piConversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PiConversation = z.infer<typeof piConversationSchema>;
export type PiImageAttachment = PiChatMessage["attachments"][number];
export const piChatEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("partial"), text: z.string() }),
  z.object({
    type: z.literal("state"),
    run: agentRunViewSchema.nullable(),
    commands: z.array(agentCommandViewSchema),
    messages: z.array(piChatMessageSchema),
  }),
  z.object({ type: z.literal("text"), delta: z.string() }),
  z.object({ type: z.literal("done"), messages: z.array(piChatMessageSchema) }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type PiChatMessage = z.infer<typeof piChatMessageSchema>;
export type PiChatEvent = z.infer<typeof piChatEventSchema>;
