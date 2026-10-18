import { z } from "zod";

/**
 * 画布图数据。整张图序列化成一个 JSON 存进 projects.graph。
 *
 * 只保留重建画布必需的字段：React Flow 运行时还会往节点上挂
 * selected / dragging / measured 等瞬时状态，那些不落盘，
 * 否则刷新后会带着上次的选中态回来，payload 也会白白变大。
 */
export const canvasNodeSchema = z.object({
  id: z.string().min(1),
  type: z.string().optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({ label: z.string() }).catchall(z.unknown()),
  /**
   * 节点在画布上的显示尺寸。只有被手动调整过或有明确默认值的节点才有
   * （媒体节点、编组）；普通节点由内容自适应，不写这两个字段。
   */
  width: z.number().positive().max(20000).optional(),
  height: z.number().positive().max(20000).optional(),
  /**
   * 所属编组的节点 id。有它时 position 是**相对父节点**的坐标，不是画布绝对坐标 ——
   * 这是 React Flow 的约定，读写两头都要记得换算。
   */
  parentId: z.string().min(1).optional(),
  /** "parent" 表示拖动被限制在父节点框内。目前只有编组的子节点会带 */
  extent: z.literal("parent").optional(),
});

export const canvasEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().nullish(),
  targetHandle: z.string().nullish(),
  type: z.string().optional(),
});

export const viewportSchema = z.object({
  x: z.number(),
  y: z.number(),
  zoom: z.number().positive(),
});

export const projectGraphSchema = z.object({
  // 上限是防御性的：画布是整体覆盖写，没有上限时一次异常请求就能塞爆单元格
  nodes: z.array(canvasNodeSchema).max(500),
  edges: z.array(canvasEdgeSchema).max(1000),
  viewport: viewportSchema,
});

export type CanvasNode = z.infer<typeof canvasNodeSchema>;
export type CanvasEdge = z.infer<typeof canvasEdgeSchema>;
export type ProjectGraph = z.infer<typeof projectGraphSchema>;
export const saveGraphSchema = z.object({
  graph: projectGraphSchema,
  expectedVersion: z.number().int().nonnegative(),
});

/** 编组在 React Flow 里的 node.type。用的是 React Flow 内置的 group 语义 */
export const GROUP_NODE_TYPE = "group";

/** 编组框比选区外扩这么多，四周留出能看见的边距 */
export const GROUP_PADDING = 32;

/** 编组标题栏的高度，算在编组框内，子节点从标题下面开始排 */
export const GROUP_HEADER_HEIGHT = 28;

/** 新项目的初始图，也是 DB 列的默认值 */
export const EMPTY_GRAPH: ProjectGraph = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export const EMPTY_GRAPH_JSON = JSON.stringify(EMPTY_GRAPH);
