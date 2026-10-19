import { z } from "zod";
import { generateImageRequestSchema, imageGenNodeDataSchema } from "./image-gen";
import { generateVideoRequestSchema, videoGenNodeDataSchema } from "./video-gen";

const id = z.string().min(1).max(200);
const ids = z.array(id).min(1).max(500);
const position = z.object({ x: z.number().finite(), y: z.number().finite() });
export const imageParametersSchema = imageGenNodeDataSchema
  .pick({ model: true, quality: true, sizePreset: true, aspectRatio: true, imageSize: true })
  .partial()
  .strict();
export const videoParametersSchema = videoGenNodeDataSchema
  .pick({
    version: true,
    mode: true,
    resolution: true,
    ratio: true,
    duration: true,
    generateAudio: true,
  })
  .partial()
  .strict();
const nodeSpec = z
  .object({
    kind: z.enum(["text", "image", "video"]),
    label: z.string().max(200).optional(),
    text: z.string().max(32000).optional(),
    prompt: z.string().max(32000).optional(),
    image: imageParametersSchema.optional(),
    video: videoParametersSchema.optional(),
    position: position.optional(),
  })
  .strict();
export const canvasToolSchemas = {
  get_canvas: z.object({}).strict(),
  get_nodes: z.object({ nodeIds: ids }).strict(),
  create_nodes: z.object({ nodes: z.array(nodeSpec).min(1).max(500) }).strict(),
  update_nodes: z
    .object({
      updates: z
        .array(nodeSpec.omit({ kind: true, position: true }).extend({ nodeId: id }))
        .min(1)
        .max(500),
    })
    .strict(),
  connect_nodes: z
    .object({
      connections: z
        .array(z.object({ source: id, target: id }))
        .min(1)
        .max(1000),
    })
    .strict(),
  arrange_nodes: z
    .object({
      nodeIds: ids,
      layout: z.enum(["horizontal", "vertical", "grid"]),
      gap: z.number().min(0).max(1000).optional(),
    })
    .strict(),
  group_nodes: z.object({ nodeIds: ids.min(2), label: z.string().max(200).optional() }).strict(),
  ungroup_nodes: z.object({ groupId: id }).strict(),
  generate_nodes: z.object({ nodeIds: ids }).strict(),
  get_generation_status: z.object({ jobIds: ids }).strict(),
};
export type CanvasToolName = keyof typeof canvasToolSchemas;
export const canvasToolNameSchema = z.enum(
  Object.keys(canvasToolSchemas) as [CanvasToolName, ...CanvasToolName[]],
);
export const canvasReceiptSchema = z.object({
  success: z.boolean(),
  revision: z.number().int().nonnegative(),
  applied: z.boolean().default(false),
  saved: z.boolean().default(true),
  code: z.string().optional(),
  message: z.string().optional(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type CanvasReceipt = z.infer<typeof canvasReceiptSchema>;
export const canvasCommandSchema = z.object({
  id,
  runId: id,
  name: canvasToolNameSchema,
  args: z.record(z.string(), z.unknown()),
  expectedRevision: z.number().int().nonnegative().nullable(),
});
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;
export const agentRunStatusSchema = z.enum([
  "running",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export const agentRunViewSchema = z.object({
  id,
  projectId: z.number().int(),
  clientId: id,
  status: agentRunStatusSchema,
  error: z.string().nullable(),
  partial: z.string(),
  conversationId: z.string().nullable().optional(),
});
export const agentCommandViewSchema = canvasCommandSchema.extend({
  status: z.enum(["pending", "completed", "failed", "cancelled", "unknown"]),
  result: canvasReceiptSchema.nullable(),
  progress: z.string().optional(),
});
export type AgentRunView = z.infer<typeof agentRunViewSchema>;
export type AgentCommandView = z.infer<typeof agentCommandViewSchema>;
export const startAgentRunSchema = z.object({
  message: z.string().trim().min(1).max(32000),
  requestId: id,
  clientId: id,
  selectedNodeIds: z.array(id).max(500).default([]),
  conversationId: id.optional(),
  imageNodeIds: z.array(id).max(6).default([]),
});
export const commandResultSchema = z.object({ clientId: id, result: canvasReceiptSchema });
export const generationJobRequestSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("image"),
    requestId: z.string().min(1).max(500),
    runId: id.optional(),
    nodeId: id,
    input: generateImageRequestSchema.omit({ projectId: true }),
  }),
  z.object({
    kind: z.literal("video"),
    requestId: z.string().min(1).max(500),
    runId: id.optional(),
    nodeId: id,
    input: generateVideoRequestSchema.omit({ projectId: true }),
  }),
]);
export const generationJobViewSchema = z.object({
  id,
  projectId: z.number().int().nullable(),
  nodeId: id,
  kind: z.enum(["image", "video"]),
  status: z.enum(["running", "succeeded", "failed", "unknown"]),
  resultUrl: z.string().nullable(),
  error: z.string().nullable(),
  input: z.record(z.string(), z.unknown()),
});
export type GenerationJobRequest = z.infer<typeof generationJobRequestSchema>;
export type GenerationJobView = z.infer<typeof generationJobViewSchema>;

export const CANVAS_TOOL_LABELS: Record<CanvasToolName, string> = {
  get_canvas: "读取画布",
  get_nodes: "读取节点",
  create_nodes: "创建节点",
  update_nodes: "修改节点",
  connect_nodes: "连接节点",
  arrange_nodes: "排列节点",
  group_nodes: "编组",
  ungroup_nodes: "解组",
  generate_nodes: "生成素材",
  get_generation_status: "查询生成状态",
};
