import type { Node } from "@xyflow/react";

/**
 * 多选节点的排布计算。
 *
 * 全是纯函数：进去一份节点数组，出来一份新的节点数组，不碰 React Flow 的 store。
 * 调用方负责 setNodes + 入历史栈 —— 这样每次排布都能整体撤销。
 */

/** 整理 / 分布时节点之间留的间距 */
export const LAYOUT_GAP = 40;

export type AlignMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom";

type Box = { id: string; x: number; y: number; width: number; height: number };

/**
 * 节点的实际占位尺寸。
 * 媒体节点有显式的 width/height；普通节点靠内容自适应，尺寸只存在于
 * React Flow 量出来的 measured 里。两个都拿不到时按 0 算，
 * 至少左/上对齐还是对的。
 */
function sizeOf(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  };
}

function boxesOf(nodes: Node[], ids: Set<string>): Box[] {
  return nodes
    .filter((node) => ids.has(node.id))
    .map((node) => ({ id: node.id, ...node.position, ...sizeOf(node) }));
}

/** 按 id 把算好的新坐标贴回原数组，未参与的节点原样返回（保持引用不变） */
function applyPositions(nodes: Node[], moved: Map<string, { x: number; y: number }>): Node[] {
  return nodes.map((node) => {
    const position = moved.get(node.id);
    return position ? { ...node, position } : node;
  });
}

export function alignNodes(nodes: Node[], selectedIds: string[], mode: AlignMode): Node[] {
  const ids = new Set(selectedIds);
  const boxes = boxesOf(nodes, ids);
  if (boxes.length < 2) return nodes;

  const left = Math.min(...boxes.map((box) => box.x));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const top = Math.min(...boxes.map((box) => box.y));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;

  const moved = new Map<string, { x: number; y: number }>();
  for (const box of boxes) {
    switch (mode) {
      case "left":
        moved.set(box.id, { x: left, y: box.y });
        break;
      case "centerX":
        moved.set(box.id, { x: centerX - box.width / 2, y: box.y });
        break;
      case "right":
        moved.set(box.id, { x: right - box.width, y: box.y });
        break;
      case "top":
        moved.set(box.id, { x: box.x, y: top });
        break;
      case "centerY":
        moved.set(box.id, { x: box.x, y: centerY - box.height / 2 });
        break;
      case "bottom":
        moved.set(box.id, { x: box.x, y: bottom - box.height });
        break;
    }
  }

  return applyPositions(nodes, moved);
}

/**
 * 整理节点：按阅读顺序（先上后下、同排先左后右）重新排成一个网格。
 *
 * 列数取节点数的平方根，尽量排成方形而不是一长条。
 * 每列宽度取该列最宽的节点、每行高度取该行最高的，所以大小不一的素材
 * 也不会互相压住；同一行的节点按顶部对齐。
 * 整体锚定在原选区的左上角，整理完不会跑到视口外面去。
 */
export function arrangeNodes(nodes: Node[], selectedIds: string[], gap = LAYOUT_GAP): Node[] {
  const ids = new Set(selectedIds);
  const boxes = boxesOf(nodes, ids);
  if (boxes.length < 2) return nodes;

  const originX = Math.min(...boxes.map((box) => box.x));
  const originY = Math.min(...boxes.map((box) => box.y));

  // 排序前先按当前位置归行：y 差在半个身位以内的算同一排，避免
  // 视觉上明明并排、却因为差几像素被拆到不同行
  const sorted = [...boxes].sort((a, b) => {
    const rowGap = Math.min(a.height, b.height) / 2;
    if (Math.abs(a.y - b.y) > rowGap) return a.y - b.y;
    return a.x - b.x;
  });

  const columns = Math.ceil(Math.sqrt(sorted.length));
  const rows = Math.ceil(sorted.length / columns);

  const columnWidths = Array.from({ length: columns }, (_, col) =>
    Math.max(0, ...sorted.filter((_, index) => index % columns === col).map((box) => box.width)),
  );
  const rowHeights = Array.from({ length: rows }, (_, row) =>
    Math.max(
      0,
      ...sorted.filter((_, index) => Math.floor(index / columns) === row).map((box) => box.height),
    ),
  );

  const moved = new Map<string, { x: number; y: number }>();
  sorted.forEach((box, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = originX + columnWidths.slice(0, col).reduce((sum, width) => sum + width + gap, 0);
    const y = originY + rowHeights.slice(0, row).reduce((sum, height) => sum + height + gap, 0);
    moved.set(box.id, { x, y });
  });

  return applyPositions(nodes, moved);
}

export type SpacingMode = "distributeX" | "distributeY";

/** 等距分布要两端固定、中间摊开，少于 3 个没有可分的空隙 */
export const DISTRIBUTE_MIN = 3;

/**
 * 等距分布：沿轴向两端的节点不动，中间的重新摊开成等距。
 * 曾经还有「按固定间距收拢」两档，用得少、和整理节点重叠，去掉了。
 */
export function spaceNodes(nodes: Node[], selectedIds: string[], mode: SpacingMode): Node[] {
  const ids = new Set(selectedIds);
  const boxes = boxesOf(nodes, ids);
  const horizontal = mode === "distributeX";

  if (boxes.length < DISTRIBUTE_MIN) return nodes;

  const start = (box: Box) => (horizontal ? box.x : box.y);
  const extent = (box: Box) => (horizontal ? box.width : box.height);

  const sorted = [...boxes].sort((a, b) => start(a) - start(b));
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return nodes;

  const total = sorted.reduce((sum, box) => sum + extent(box), 0);
  const span = start(last) + extent(last) - start(first);
  // 空隙由总跨度倒推，可能是负数（节点本来就挤到重叠），照算即可，
  // 结果仍然是「重叠得一样多」，比强行掰开更符合预期
  const gap = (span - total) / (sorted.length - 1);

  const moved = new Map<string, { x: number; y: number }>();
  let cursor = start(first);
  for (const box of sorted) {
    moved.set(box.id, horizontal ? { x: cursor, y: box.y } : { x: box.x, y: cursor });
    cursor += extent(box) + gap;
  }

  return applyPositions(nodes, moved);
}
