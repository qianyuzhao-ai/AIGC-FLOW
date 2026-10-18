import {
  type CanvasClipboard,
  CLIPBOARD_VERSION,
  canvasClipboardSchema,
  remapPromptTokens,
} from "@aigc-flow/shared";
import type { Edge, Node, XYPosition } from "@xyflow/react";
import { copiedNodeData, fromPersistedGraph, toPersistedGraph } from "@/lib/graph";

/**
 * 画布剪贴板的存放位置：localStorage 单槽，复制一次覆盖一次。
 *
 * 为什么不是内存：跨项目粘贴的前提就是切页面 —— 切项目时 CanvasEditor 整个卸载，
 * useRef 里的东西当场没了。localStorage 同源共享，顺带白捡两件事：
 * 刷新 / 重开浏览器后剪贴板还在，两个标签页之间也能互相粘。
 *
 * 只在事件回调里读写，不在渲染期碰它 —— SSR 阶段没有 window。
 */
const STORAGE_KEY = "aigc-flow:clipboard";

/** 写入前的体积闸门。localStorage 每个源大约 5MB，留足余量给别的用途 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export type ClipboardWriteResult = "ok" | "too-large" | "unavailable";

/**
 * 写剪贴板。失败不抛异常，由调用方决定怎么提示用户：
 * - too-large：载荷超过闸门（复制了几百个节点，或 prompt 特别长）
 * - unavailable：隐私模式 / 配额满 / 禁用了存储，setItem 会直接抛
 */
export function writeClipboard(payload: CanvasClipboard): ClipboardWriteResult {
  const raw = JSON.stringify(payload);
  if (raw.length > MAX_PAYLOAD_BYTES) return "too-large";

  try {
    window.localStorage.setItem(STORAGE_KEY, raw);
    return "ok";
  } catch {
    return "unavailable";
  }
}

/**
 * 读剪贴板。**任何异常都退回 null（当成剪贴板是空的）**：
 * 载荷会跨版本存活（上周复制的内容这周还在），版本号对不上、字段缺失、
 * 甚至根本不是 JSON 都可能，绝不能让一次粘贴把画布搞崩。
 */
export function readClipboard(): CanvasClipboard | null {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  try {
    const parsed = canvasClipboardSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/* --------------------------------- 选区 → 载荷 -------------------------------- */

/** 载荷不存视口，但 toPersistedGraph 要一个，给个占位值 */
const IGNORED_VIEWPORT = { x: 0, y: 0, zoom: 1 };

/**
 * 把选区打包成剪贴板载荷。没有可复制的节点时返回 null。
 *
 * 剥离规则整个复用 `toPersistedGraph`（未上传完的媒体节点、悬空连线、
 * `generating` 回落 idle、`selected` / `measured` 这些瞬时状态），
 * 剪贴板和落盘用同一份定义，不再抄第二遍。
 *
 * 编组的处理（本轮只有一层父子）：
 * - 选中编组 → 自动带上组内全部成员，成员的相对坐标和 parentId 原样保留；
 * - 只选中组内的部分成员 → 这些成员脱离编组，坐标换算成绝对坐标。
 *   不换算的话粘出来会飞 —— 子节点的 position 是相对父节点的。
 */
export function toClipboardPayload(
  nodes: Node[],
  edges: Edge[],
  selectedIds: string[],
  source: { projectId: number; projectName: string },
): CanvasClipboard | null {
  const ids = withGroupMembers(nodes, selectedIds);
  if (ids.size === 0) return null;

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const picked = nodes
    .filter((node) => ids.has(node.id))
    .map((node) => detachFromGroup(node, byId, ids));
  // 只带两端都在选区内的连线，否则粘出来会指向不存在的节点
  const pickedEdges = edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target));

  const graph = toPersistedGraph(picked, pickedEdges, IGNORED_VIEWPORT);
  if (graph.nodes.length === 0) return null;

  return {
    version: CLIPBOARD_VERSION,
    sourceProjectId: source.projectId,
    sourceProjectName: source.projectName,
    copiedAt: new Date().toISOString(),
    nodes: graph.nodes,
    edges: graph.edges,
  };
}

/** 选中编组等于选中它的全部成员 —— 只带个空壳组过去没有意义 */
function withGroupMembers(nodes: Node[], selectedIds: string[]): Set<string> {
  const ids = new Set(selectedIds.filter((id) => nodes.some((node) => node.id === id)));
  for (const node of nodes) {
    if (node.parentId && ids.has(node.parentId)) ids.add(node.id);
  }
  return ids;
}

/** 父节点没跟着复制的子节点：脱离编组，相对坐标加回父节点原点变成绝对坐标 */
function detachFromGroup(node: Node, byId: Map<string, Node>, ids: Set<string>): Node {
  if (!node.parentId || ids.has(node.parentId)) return node;

  const parent = byId.get(node.parentId);
  const { parentId: _parentId, extent: _extent, ...rest } = node;
  // 父节点已经不在图里时 position 本来就是绝对的（脏数据），只去掉 parentId
  if (!parent) return rest;

  return {
    ...rest,
    position: {
      x: parent.position.x + node.position.x,
      y: parent.position.y + node.position.y,
    },
  };
}

/* --------------------------------- 载荷 → 节点 -------------------------------- */

/**
 * 把剪贴板载荷还原成能直接塞进画布的节点 / 连线，整簇按 offset 平移。
 *
 * 三件必须做对的事：
 * 1. **id 全部换新**，包括 `parentId` —— 漏了 parentId 的话，同项目粘出来的成员会
 *    挂回原来那个组（表现是粘了个空壳组），跨项目更是指向一个不存在的节点，
 *    React Flow 直接报错。
 * 2. **prompt 里的徽章 token 跟着换 id**（`remapPromptTokens`）：一起粘过来的指向副本，
 *    没跟着粘的（比如只复制了生成节点、上游素材留在原项目）直接清掉 ——
 *    留着会变成一个指不到任何节点的死徽章，发请求时还会被静默丢掉。
 * 3. **只平移顶层节点**：组内子节点的 position 是相对父节点的，跟着平移会双份位移。
 *
 * 结构还原复用 `fromPersistedGraph`（补 sourcePosition / targetPosition、
 * 尺寸回填 style、父节点排在子节点前面），和打开项目走同一条路。
 */
export function fromClipboardPayload(
  payload: CanvasClipboard,
  offset: XYPosition,
): { nodes: Node[]; edges: Edge[] } {
  const restored = fromPersistedGraph({
    nodes: payload.nodes,
    edges: payload.edges,
    viewport: IGNORED_VIEWPORT,
  });

  const idMap = new Map(restored.nodes.map((node) => [node.id, crypto.randomUUID()]));

  const nodes = restored.nodes.map((node): Node => {
    const parentId = node.parentId ? idMap.get(node.parentId) : undefined;
    return {
      ...node,
      id: idMap.get(node.id) ?? crypto.randomUUID(),
      // 组内子节点的坐标是相对父节点的，只有顶层节点跟着 offset 走
      position: parentId
        ? node.position
        : { x: node.position.x + offset.x, y: node.position.y + offset.y },
      ...(parentId ? { parentId } : {}),
      data: hasPrompt(node.data)
        ? { ...copiedNodeData(node.data), prompt: remapPromptTokens(node.data.prompt, idMap) }
        : copiedNodeData(node.data),
      // 粘出来的这批成为新的选区，接着就能整体拖走
      selected: true,
    };
  });

  const edges = restored.edges.map(
    (edge): Edge => ({
      ...edge,
      id: crypto.randomUUID(),
      source: idMap.get(edge.source) ?? edge.source,
      target: idMap.get(edge.target) ?? edge.target,
    }),
  );

  return { nodes, edges };
}

/** 只有生成节点带 prompt；文本 / 媒体 / 编组没有 */
function hasPrompt(data: unknown): data is { prompt: string } {
  return typeof (data as { prompt?: unknown } | null)?.prompt === "string";
}

/**
 * 把整簇节点挪到 center（画布坐标）需要的平移量。跨项目粘贴用它落到视口中心 ——
 * 目标画布的空白区域和来源坐标毫无关系，照搬原坐标很可能粘到屏幕外去。
 *
 * 包围盒只用得到的尺寸算（媒体 / 文本 / 编组才落尺寸，生成节点的高度是内容撑出来的、
 * 载荷里没有），所以是个近似值 —— 落点差个几十像素不影响「粘在眼前」这个目的。
 */
export function offsetToCenter(payload: CanvasClipboard, center: XYPosition): XYPosition {
  const top = payload.nodes.filter((node) => !node.parentId);
  if (top.length === 0) return { x: 0, y: 0 };

  const left = Math.min(...top.map((node) => node.position.x));
  const topY = Math.min(...top.map((node) => node.position.y));
  const right = Math.max(...top.map((node) => node.position.x + (node.width ?? 0)));
  const bottom = Math.max(...top.map((node) => node.position.y + (node.height ?? 0)));

  return { x: center.x - (left + right) / 2, y: center.y - (topY + bottom) / 2 };
}
