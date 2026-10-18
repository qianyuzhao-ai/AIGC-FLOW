import {
  type CanvasEdge,
  type CanvasNode,
  GROUP_NODE_TYPE,
  IMAGE_GEN_NODE_TYPE,
  MEDIA_NODE_TYPE,
  type MediaNodeData,
  type ProjectGraph,
  STORYBOARD_NODE_TYPE,
  TEXT_NODE_TYPE,
  VIDEO_GEN_NODE_TYPE,
} from "@aigc-flow/shared";
import { type Edge, type Node, Position, type Viewport } from "@xyflow/react";

/**
 * 上传中 / 上传失败的媒体节点不落盘。
 * 存下来也没意义：刷新后 File 对象已经没了，既重试不了也拿不到 URL，
 * 只会留下一个永远"上传中"的死节点。
 */
/** 尺寸要落盘的节点类型：这几种的尺寸是用户定的，不是内容撑出来的 */
const SIZED_NODE_TYPES = new Set<string>([
  MEDIA_NODE_TYPE,
  GROUP_NODE_TYPE,
  TEXT_NODE_TYPE,
  STORYBOARD_NODE_TYPE,
]);

function isPersistable(node: Node): boolean {
  if (node.type !== MEDIA_NODE_TYPE) return true;
  return (node.data as unknown as MediaNodeData)?.status === "ready";
}

/**
 * 高频交互只检查可能落盘的字段，不展开 data、构造快照或序列化整张图。
 * React Flow 不可变更新 data，所以引用相同就能跳过提示词和分镜等大块内容。
 * 这里只做保守的变更判断；防抖后的完整比较负责过滤生成状态归一化等无效改动。
 */
export function hasGraphContentChanges(
  previous: { nodes: Node[]; edges: Edge[] },
  next: { nodes: Node[]; edges: Edge[] },
): boolean {
  if (previous.nodes.length !== next.nodes.length || previous.edges.length !== next.edges.length) {
    return true;
  }
  return (
    (previous.nodes !== next.nodes &&
      next.nodes.some((node, index) => {
        const before = previous.nodes[index];
        if (node === before) return false;
        return (
          !before ||
          node.id !== before.id ||
          node.type !== before.type ||
          node.data !== before.data ||
          node.position.x !== before.position.x ||
          node.position.y !== before.position.y ||
          node.parentId !== before.parentId ||
          (node.extent === "parent") !== (before.extent === "parent") ||
          (SIZED_NODE_TYPES.has(node.type ?? "") &&
            (node.width !== before.width || node.height !== before.height))
        );
      })) ||
    (previous.edges !== next.edges &&
      next.edges.some((edge, index) => {
        const before = previous.edges[index];
        if (edge === before) return false;
        return (
          !before ||
          edge.id !== before.id ||
          edge.source !== before.source ||
          edge.target !== before.target ||
          edge.sourceHandle !== before.sourceHandle ||
          edge.targetHandle !== before.targetHandle ||
          edge.type !== before.type
        );
      }))
  );
}

/**
 * React Flow 会往节点上挂 selected / dragging / measured 等瞬时状态。
 * 落盘前必须剥掉：否则刷新后会带着上次的选中态回来，payload 也白白变大，
 * 而且单纯点选一个节点就会被判定为「有改动」触发保存。
 */
export function toPersistedGraph(nodes: Node[], edges: Edge[], viewport: Viewport): ProjectGraph {
  const kept = nodes.filter(isPersistable);
  const keptIds = new Set(kept.map((node) => node.id));

  return {
    nodes: kept.map(
      (node): CanvasNode => ({
        id: node.id,
        type: node.type,
        position: node.position,
        data: persistedData(node),
        // 只落媒体节点和编组的尺寸。普通节点的 width/height 是 React Flow 量出来的，
        // 存下来会让"内容自适应"变成"锁死在上次量到的值"
        // 锁比例拖拽会算出 632.888…/112.5 这种小数，落库前取整。
        // 放在这一处而不是 onResizeEnd：这是尺寸写出去的唯一出口，
        // 不依赖某个回调有没有被触发。
        ...(SIZED_NODE_TYPES.has(node.type ?? "") && node.width && node.height
          ? { width: Math.round(node.width), height: Math.round(node.height) }
          : {}),
        // 父子关系。注意此时的 position 已经是相对父节点的坐标了
        ...(node.parentId && keptIds.has(node.parentId)
          ? { parentId: node.parentId, ...(node.extent === "parent" ? { extent: "parent" } : {}) }
          : {}),
      }),
    ),
    // 丢掉指向已被过滤节点的悬空连线，否则加载时会连到不存在的节点
    edges: edges
      .filter((edge) => keptIds.has(edge.source) && keptIds.has(edge.target))
      .map(
        (edge): CanvasEdge => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          sourceHandle: edge.sourceHandle,
          targetHandle: edge.targetHandle,
          type: edge.type,
        }),
      ),
    viewport,
  };
}

/**
 * 后端返回的图恢复成 React Flow 能吃的结构。
 * 顺手补上左右连接点：React Flow 默认端口在上下，横向流程连出来会绕一圈。
 * 这两个字段是纯展示的，不落盘。
 */
export function fromPersistedGraph(graph: ProjectGraph): { nodes: Node[]; edges: Edge[] } {
  // 媒体节点现在只剩右侧 source，没有入口。历史数据里指向它的连线在 UI 上
  // 已经无处落脚，留着只会画成一根接在节点中心的怪线，加载时直接丢掉。
  const mediaIds = new Set(
    graph.nodes.filter((node) => node.type === MEDIA_NODE_TYPE).map((node) => node.id),
  );

  const nodeIds = new Set(graph.nodes.map((node) => node.id));

  return {
    // React Flow 要求父节点排在子节点前面，否则子节点挂不上去，直接报错。
    // 落盘顺序不保证这一点（编组是后建的，会排在成员后面），这里统一重排一次。
    nodes: sortParentsFirst(graph.nodes).map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      // 父节点可能已经不在了（比如脏数据），这时候必须把 parentId 一起丢掉，
      // 否则 React Flow 会因为找不到父节点抛错，整张画布打不开
      ...(node.parentId && nodeIds.has(node.parentId)
        ? { parentId: node.parentId, ...(node.extent === "parent" ? { extent: "parent" } : {}) }
        : {}),
      ...(node.width && node.height
        ? {
            width: node.width,
            height: node.height,
            // style 也要给：React Flow 靠它渲染尺寸，只给 width/height 会被重新量一遍
            style: { width: node.width, height: node.height },
          }
        : {}),
    })),
    edges: graph.edges
      .filter((edge) => !mediaIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? undefined,
        targetHandle: edge.targetHandle ?? undefined,
        type: edge.type,
      })),
  };
}

/** 运行状态由生成任务查询恢复，画布快照本身不维持加载动画。 */
const GENERATING_NODE_TYPES = new Set<string>([IMAGE_GEN_NODE_TYPE, VIDEO_GEN_NODE_TYPE]);

/**
 * 生成类节点的「生成中」是运行时状态，落盘一律回退成 idle ——
 * 刷新后由 generationJobId / generationRequestId 查询实际状态。
 */
function persistedData(node: Node): CanvasNode["data"] {
  const data: CanvasNode["data"] = {
    ...node.data,
    label: String(node.data?.label ?? "未命名节点"),
  };
  if (GENERATING_NODE_TYPES.has(node.type ?? "") && data.status === "generating") {
    return { ...data, status: "idle" };
  }
  return data;
}

/** A copied node keeps its media, but never inherits ownership of another node's task. */
export function copiedNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const { generationJobId: _job, generationRequestId: _request, ...copy } = structuredClone(data);
  if (copy.status === "generating") copy.status = copy.resultUrl ? "ready" : "idle";
  return copy;
}

/** 父节点排前、子节点排后。只有一层父子，不用做拓扑排序 */
function sortParentsFirst(nodes: CanvasNode[]): CanvasNode[] {
  return [...nodes.filter((node) => !node.parentId), ...nodes.filter((node) => node.parentId)];
}

/** 比较两张图是否等价，用于判断「有没有未保存的改动」 */
export function isSameGraph(a: ProjectGraph, b: ProjectGraph): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
