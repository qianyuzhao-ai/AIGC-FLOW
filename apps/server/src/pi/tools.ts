import { type CanvasToolName, canvasToolSchemas } from "@aigc-flow/shared";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import { dispatchCanvasTool } from "./bridge";

const descriptions: Record<CanvasToolName, string> = {
  get_canvas: "读取当前项目实时画布摘要、选区、支持的生成模型与默认参数。操作前先读取。",
  get_nodes: "读取指定节点的完整文本、提示词和生成参数；只读，不理解图片视频像素内容。",
  create_nodes: "创建文本、图片生成或视频生成节点；不会自动生成素材。",
  update_nodes: "修改指定节点的名称、提示词、文本或生成参数。",
  connect_nodes: "按明确的 source/target ID 连接节点，用作文本或媒体参考。",
  arrange_nodes: "将同层级节点按指定顺序横向、纵向或网格排列。",
  group_nodes: "将至少两个顶层普通节点编组，不支持嵌套。",
  ungroup_nodes: "解除指定编组，保留成员。",
  generate_nodes:
    "仅当用户明确要求生成时调用。按给定顺序逐个生成图片或视频，每节点本轮最多一次，不自动重试。",
  get_generation_status: "查询当前项目指定生成任务的真实状态。",
};
export function canvasTools(projectId: number): ToolDefinition[] {
  return Object.entries(canvasToolSchemas).map(([name, schema]) => ({
    name,
    label: name,
    description: descriptions[name as CanvasToolName],
    executionMode: "sequential",
    // Pi 接收 JSON Schema；Zod 是客户端、服务端和模型声明的同一份契约来源。
    parameters: z.toJSONSchema(schema) as ToolDefinition["parameters"],
    execute: async (_id, args, signal, onUpdate) => {
      const result = await dispatchCanvasTool(
        projectId,
        name as CanvasToolName,
        schema.parse(args),
        signal,
        (text) => onUpdate?.({ content: [{ type: "text", text }], details: {} }),
      );
      if (!result.success) throw new Error(JSON.stringify(result));
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  }));
}
