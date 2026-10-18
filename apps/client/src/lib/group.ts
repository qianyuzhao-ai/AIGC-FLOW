import { GROUP_HEADER_HEIGHT, GROUP_NODE_TYPE, GROUP_PADDING } from "@aigc-flow/shared";
import type { Node } from "@xyflow/react";

/**
 * 编组 / 解组。
 *
 * 全是纯函数：进去一份节点数组，出来一份新的，不碰 React Flow 的 store。
 * 调用方负责 setNodes + 入历史栈。
 *
 * 核心是坐标换算：React Flow 里子节点的 position 是**相对父节点**的，
 * 编组时要把绝对坐标减去组的原点，解组时再加回来。漏了哪一头，
 * 节点都会瞬间飞到画布的另一个角落。
 */

const DEFAULT_GROUP_LABEL = "编组";

function sizeOf(node: Node): { width: number; height: number } {
  return {
    width: node.measured?.width ?? node.width ?? 0,
    height: node.measured?.height ?? node.height ?? 0,
  };
}

export function isGroupNode(node: Node): boolean {
  return node.type === GROUP_NODE_TYPE;
}

/** 某个编组下的所有子节点 id */
export function groupChildIds(nodes: Node[], groupId: string): string[] {
  return nodes.filter((node) => node.parentId === groupId).map((node) => node.id);
}

/**
 * 选区能不能编组。
 * 至少两个；本轮不支持嵌套，所以选区里不能有编组，也不能有已经属于某个编组的节点。
 */
export function canGroup(nodes: Node[], selectedIds: string[]): boolean {
  if (selectedIds.length < 2) return false;

  const ids = new Set(selectedIds);
  const selected = nodes.filter((node) => ids.has(node.id));
  if (selected.length < 2) return false;

  return selected.every((node) => !isGroupNode(node) && !node.parentId);
}

/** 选区是不是「正好一个编组」—— 工具条切到解组形态的判据 */
export function selectedGroupId(nodes: Node[], selectedIds: string[]): string | null {
  if (selectedIds.length !== 1) return null;
  const node = nodes.find((item) => item.id === selectedIds[0]);
  return node && isGroupNode(node) ? node.id : null;
}

/**
 * 排布类操作（整理 / 对齐 / 间距）真正该动的那批节点。
 *
 * 两件事：
 * 1. 父节点被选中时，它的子节点要剔掉 —— 动父节点就已经带着子节点走了，
 *    再单独动一遍是双重位移。
 * 2. 只保留同属一个父级的，因为子节点的坐标是相对父节点的、顶层节点是绝对的，
 *    混在一起算包围盒得到的是垃圾数字。混选时优先顶层：框选跨过一个编组和
 *    几个组外节点是常见操作，⌘ 点选跨组则很罕见。
 */
export function sameParentSelection(nodes: Node[], selectedIds: string[]): string[] {
  const ids = new Set(selectedIds);
  const selected = nodes.filter(
    (node) => ids.has(node.id) && !(node.parentId && ids.has(node.parentId)),
  );

  const topLevel = selected.filter((node) => !node.parentId);
  if (topLevel.length > 0) return topLevel.map((node) => node.id);

  const first = selected[0];
  if (!first) return [];
  return selected.filter((node) => node.parentId === first.parentId).map((node) => node.id);
}

/**
 * 把选中的节点包进一个新编组。
 *
 * 组框 = 选区包围盒四周外扩 GROUP_PADDING，顶部再多留一条标题栏的高度。
 * 返回的数组里编组排在成员前面 —— React Flow 要求父节点先于子节点出现。
 */
export function groupNodes(
  nodes: Node[],
  selectedIds: string[],
  groupId: string = crypto.randomUUID(),
): Node[] {
  if (!canGroup(nodes, selectedIds)) return nodes;

  const ids = new Set(selectedIds);
  const members = nodes.filter((node) => ids.has(node.id));

  const left = Math.min(...members.map((node) => node.position.x));
  const top = Math.min(...members.map((node) => node.position.y));
  const right = Math.max(...members.map((node) => node.position.x + sizeOf(node).width));
  const bottom = Math.max(...members.map((node) => node.position.y + sizeOf(node).height));

  const origin = { x: left - GROUP_PADDING, y: top - GROUP_PADDING - GROUP_HEADER_HEIGHT };
  const size = {
    width: right - left + GROUP_PADDING * 2,
    height: bottom - top + GROUP_PADDING * 2 + GROUP_HEADER_HEIGHT,
  };

  const group: Node = {
    id: groupId,
    type: GROUP_NODE_TYPE,
    position: origin,
    data: { label: DEFAULT_GROUP_LABEL },
    width: size.width,
    height: size.height,
    style: size,
    selected: true,
  };

  const children: Node[] = members.map((node) => ({
    ...node,
    // 绝对坐标 → 相对组原点
    position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
    parentId: group.id,
    extent: "parent",
    // 成员取消选中，让新建的编组成为唯一选区，紧接着就能解组 / 改名
    selected: false,
  }));

  return [...nodes.filter((node) => !ids.has(node.id)), group, ...children];
}

/** 拆掉编组，成员留在画布上，坐标换回绝对值 */
export function ungroupNodes(nodes: Node[], groupId: string): Node[] {
  const group = nodes.find((node) => node.id === groupId);
  if (!group || !isGroupNode(group)) return nodes;

  return nodes
    .filter((node) => node.id !== groupId)
    .map((node) => {
      if (node.parentId !== groupId) return node;

      const { parentId: _parentId, extent: _extent, ...rest } = node;
      return {
        ...rest,
        // 相对组原点 → 绝对坐标
        position: {
          x: group.position.x + node.position.x,
          y: group.position.y + node.position.y,
        },
        selected: true,
      };
    });
}
