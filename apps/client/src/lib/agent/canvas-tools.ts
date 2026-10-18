import {
  type CanvasCommand,
  canvasToolSchemas,
  DEFAULT_IMAGE_GEN_DATA,
  DEFAULT_TEXT_NODE_DATA,
  DEFAULT_VIDEO_GEN_DATA,
  GROUP_PADDING,
  IMAGE_GEN_NODE_TYPE,
  IMAGE_MODELS,
  projectGraphSchema,
  syncPromptTokens,
  TEXT_NODE_HEIGHT,
  TEXT_NODE_TYPE,
  TEXT_NODE_WIDTH,
  VIDEO_GEN_NODE_TYPE,
  VIDEO_VERSIONS,
} from "@aigc-flow/shared";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { canConnectNodes } from "../connection";
import { toPersistedGraph } from "../graph";
import { canGroup, groupNodes, sameParentSelection, ungroupNodes } from "../group";
import { arrangeNodes } from "../layout";

export type CanvasState = {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
  center: { x: number; y: number };
};
export type CanvasBinding = {
  read(): CanvasState;
  apply(nodes: Node[], edges: Edge[], history: boolean): void;
  save(): Promise<boolean>;
  focus(nodeIds: string[]): void;
};
const exposedFields = [
  "label",
  "text",
  "prompt",
  "model",
  "version",
  "mode",
  "quality",
  "sizePreset",
  "aspectRatio",
  "imageSize",
  "resolution",
  "ratio",
  "duration",
  "generateAudio",
  "kind",
  "status",
  "generationJobId",
  "generationPrompt",
];
export function describeNode(node: Node, detail = false) {
  const data = Object.fromEntries(
    (detail ? exposedFields : ["label", "status", "kind", "generationJobId"])
      .filter((key) => node.data[key] !== undefined)
      .map((key) => [key, node.data[key]]),
  );
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    parentId: node.parentId,
    data,
    hasResult: Boolean(node.data.resultUrl || node.data.url),
  };
}
function requireNodes(nodes: Node[], ids: string[]) {
  if (new Set(ids).size !== ids.length) throw new Error("节点 ID 不能重复");
  return ids.map((id) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) throw new Error(`节点 ${id} 已不存在，请重新读取画布`);
    return node;
  });
}
function measured(nodes: Node[]): Node[] {
  return nodes.map((node) => ({
    ...node,
    measured: {
      width:
        node.measured?.width ??
        node.width ??
        (node.type === TEXT_NODE_TYPE ? TEXT_NODE_WIDTH : 534),
      height:
        node.measured?.height ??
        node.height ??
        (node.type === TEXT_NODE_TYPE ? TEXT_NODE_HEIGHT : 480),
    },
  }));
}
export function applyCanvasTool(command: CanvasCommand, state: CanvasState) {
  let { nodes, edges } = state;
  let data: Record<string, unknown> = {};
  let changed = false;
  switch (command.name) {
    case "get_canvas":
      return {
        nodes,
        edges,
        changed,
        data: {
          nodes: nodes.map((n) => describeNode(n)),
          edges: edges.map(({ source, target }) => ({ source, target })),
          selectedNodeIds: nodes.filter((n) => n.selected).map((n) => n.id),
          imageModels: IMAGE_MODELS,
          videoVersions: VIDEO_VERSIONS,
          defaults: { image: DEFAULT_IMAGE_GEN_DATA, video: DEFAULT_VIDEO_GEN_DATA },
        },
      };
    case "get_nodes": {
      const args = canvasToolSchemas.get_nodes.parse(command.args);
      return {
        nodes,
        edges,
        changed,
        data: { nodes: requireNodes(nodes, args.nodeIds).map((n) => describeNode(n, true)) },
      };
    }
    case "create_nodes": {
      const args = canvasToolSchemas.create_nodes.parse(command.args);
      const created = args.nodes.map((spec, index): Node => {
        const id = `${command.id}-${index}`;
        if (nodes.some((node) => node.id === id)) throw new Error("命令已应用，请刷新运行状态");
        if ((spec.kind !== "image" && spec.image) || (spec.kind !== "video" && spec.video))
          throw new Error("生成参数与节点类型不匹配");
        const defaults =
          spec.kind === "image"
            ? DEFAULT_IMAGE_GEN_DATA
            : spec.kind === "video"
              ? DEFAULT_VIDEO_GEN_DATA
              : DEFAULT_TEXT_NODE_DATA;
        return {
          id,
          type:
            spec.kind === "image"
              ? IMAGE_GEN_NODE_TYPE
              : spec.kind === "video"
                ? VIDEO_GEN_NODE_TYPE
                : TEXT_NODE_TYPE,
          position: spec.position ?? {
            x: state.center.x - 267 + index * 574,
            y: state.center.y - 240,
          },
          ...(spec.kind === "text"
            ? {
                width: TEXT_NODE_WIDTH,
                height: TEXT_NODE_HEIGHT,
                style: { width: TEXT_NODE_WIDTH, height: TEXT_NODE_HEIGHT },
              }
            : {}),
          data: {
            ...defaults,
            ...(spec.image ?? spec.video),
            ...(spec.label ? { label: spec.label } : {}),
            ...(spec.kind === "text" ? { text: spec.text ?? "" } : { prompt: spec.prompt ?? "" }),
          },
        };
      });
      nodes = [...nodes, ...created];
      data = {
        nodeIds: created.map((n) => n.id),
        nodes: created.map((n) => describeNode(n, true)),
      };
      changed = true;
      break;
    }
    case "update_nodes": {
      const { updates } = canvasToolSchemas.update_nodes.parse(command.args);
      requireNodes(
        nodes,
        updates.map((patch) => patch.nodeId),
      );
      nodes = nodes.map((node) => {
        const patch = updates.find((item) => item.nodeId === node.id);
        if (!patch) return node;
        if (
          (patch.image && node.type !== IMAGE_GEN_NODE_TYPE) ||
          (patch.video && node.type !== VIDEO_GEN_NODE_TYPE) ||
          (patch.text !== undefined && node.type !== TEXT_NODE_TYPE) ||
          (patch.prompt !== undefined &&
            ![IMAGE_GEN_NODE_TYPE, VIDEO_GEN_NODE_TYPE].includes(node.type ?? ""))
        )
          throw new Error("字段与节点类型不匹配");
        return {
          ...node,
          data: {
            ...node.data,
            ...(patch.image ?? patch.video),
            ...(patch.label !== undefined ? { label: patch.label } : {}),
            ...(patch.text !== undefined ? { text: patch.text } : {}),
            ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
          },
        };
      });
      data = { nodeIds: updates.map((p) => p.nodeId) };
      changed = true;
      break;
    }
    case "connect_nodes": {
      const { connections } = canvasToolSchemas.connect_nodes.parse(command.args);
      connections.forEach((connection, index) => {
        const [source, target] = requireNodes(nodes, [connection.source, connection.target]);
        if (!source || !target || !canConnectNodes(source, target))
          throw new Error("不支持这两个节点之间的连接");
        if (edges.some((edge) => edge.source === source.id && edge.target === target.id)) return;
        edges = [...edges, { id: `${command.id}-${index}`, source: source.id, target: target.id }];
        if (source.type === TEXT_NODE_TYPE)
          nodes = nodes.map((n) =>
            n.id === target.id
              ? {
                  ...n,
                  data: {
                    ...n.data,
                    prompt: syncPromptTokens(String(n.data.prompt ?? ""), [source.id], []),
                  },
                }
              : n,
          );
      });
      data = { connections };
      changed = true;
      break;
    }
    case "arrange_nodes": {
      const { nodeIds, layout, gap = 40 } = canvasToolSchemas.arrange_nodes.parse(command.args);
      requireNodes(nodes, nodeIds);
      if (sameParentSelection(nodes, nodeIds).length !== nodeIds.length)
        throw new Error("排列的节点必须处在同一编组层级");
      const sized = measured(nodes);
      if (layout === "grid") nodes = arrangeNodes(sized, nodeIds, gap);
      else {
        const targets = requireNodes(sized, nodeIds);
        let cursor = Math.min(
          ...targets.map((n) => (layout === "horizontal" ? n.position.x : n.position.y)),
        );
        const cross = Math.min(
          ...targets.map((n) => (layout === "horizontal" ? n.position.y : n.position.x)),
        );
        const positions = new Map(
          targets.map((node) => {
            const position =
              layout === "horizontal" ? { x: cursor, y: cross } : { x: cross, y: cursor };
            cursor +=
              (layout === "horizontal"
                ? (node.measured?.width ?? 534)
                : (node.measured?.height ?? 480)) + gap;
            return [node.id, position];
          }),
        );
        nodes = nodes.map((node) =>
          positions.has(node.id)
            ? { ...node, position: positions.get(node.id) ?? node.position }
            : node,
        );
      }
      const parentId = nodes.find((node) => node.id === nodeIds[0])?.parentId;
      if (parentId) {
        const children = measured(nodes.filter((node) => node.parentId === parentId));
        const width =
          Math.max(...children.map((node) => node.position.x + (node.measured?.width ?? 0))) +
          GROUP_PADDING;
        const height =
          Math.max(...children.map((node) => node.position.y + (node.measured?.height ?? 0))) +
          GROUP_PADDING;
        nodes = nodes.map((node) =>
          node.id === parentId
            ? {
                ...node,
                width,
                height,
                measured: { width, height },
                style: { ...node.style, width, height },
              }
            : node,
        );
      }
      data = { nodeIds, layout };
      changed = true;
      break;
    }
    case "group_nodes": {
      const { nodeIds, label } = canvasToolSchemas.group_nodes.parse(command.args);
      requireNodes(nodes, nodeIds);
      if (!canGroup(nodes, nodeIds))
        throw new Error("需要至少两个未编组的普通节点，不支持嵌套编组");
      nodes = groupNodes(measured(nodes), nodeIds, command.id).map((n) =>
        n.id === command.id && label ? { ...n, data: { ...n.data, label } } : n,
      );
      data = { groupId: command.id, nodeIds };
      changed = true;
      break;
    }
    case "ungroup_nodes": {
      const { groupId } = canvasToolSchemas.ungroup_nodes.parse(command.args);
      const group = requireNodes(nodes, [groupId])[0];
      if (group?.type !== "group") throw new Error("目标不是编组");
      nodes = ungroupNodes(nodes, groupId);
      data = { groupId };
      changed = true;
      break;
    }
    default:
      throw new Error("生成任务由生成执行器处理");
  }
  projectGraphSchema.parse(toPersistedGraph(nodes, edges, state.viewport));
  return { nodes, edges, data, changed };
}
