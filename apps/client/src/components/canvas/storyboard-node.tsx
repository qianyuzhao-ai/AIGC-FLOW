"use client";

import {
  normalizeStoryboardRows,
  type StoryboardNodeData,
  type StoryboardRow,
} from "@aigc-flow/shared";
import { type NodeProps, NodeResizer, useReactFlow, useStore } from "@xyflow/react";
import { Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { GEN_ACCENT } from "./gen-node-controls";
import { NodeInfoBar } from "./node-info-bar";
import { StoryboardDialog } from "./storyboard-dialog";
import { StoryboardTable } from "./storyboard-table";

/** 缩放手柄样式，对齐媒体节点和文本节点 */
const RESIZE_HANDLE_STYLE = {
  width: 9,
  height: 9,
  borderRadius: 2,
  border: `1px solid ${GEN_ACCENT}`,
  backgroundColor: "#fff",
} as const;

/**
 * 分镜表节点：画布上就是一张可逐格编辑的表（镜号 / 镜头 / 时长 / 台词 / 表演 /
 * 表演 Prompt / 完整 Prompt），可自由拉伸，页脚的「放大」把整张表放进弹层。
 *
 * 目前**不参与连线**（没有 handle），是一张纯粹的工作表；
 * 逐行建生成节点、整表当 text 连出去这些以后再接。
 */
export function StoryboardNode({ id, data, selected }: NodeProps) {
  const board = data as unknown as StoryboardNodeData;
  const { updateNodeData } = useReactFlow();
  // 信息条要在屏幕上保持固定大小；没选中时没有信息条，返回常量免得跟着缩放重渲
  const zoom = useStore((state) => (selected ? state.transform[2] : 1));
  const [expanded, setExpanded] = useState(false);
  /**
   * 列的语义改过一轮，旧节点会带着老形状的值回来（见 normalizeStoryboardRows）。
   * useMemo + 「没变就返回原数组」两头配合，读一次不会被判定成有改动去存盘。
   */
  const rows = useMemo(() => normalizeStoryboardRows(board.rows ?? []), [board.rows]);

  /**
   * 写回节点。走 updateNodeData 而不是 canvasActions —— 和文本节点的正文一样，
   * 表格内容不进撤销栈（逐字入栈的话按一次 ⌘Z 只退一个字），
   * 由 graph 的自动保存兜住。
   */
  function commit(next: StoryboardRow[]) {
    // 行操作的纯函数在「没变化」时返回原数组，此时不写，免得白白触发一次保存
    if (next === rows) return;
    updateNodeData(id, { rows: next });
  }

  return (
    <>
      <NodeResizer
        isVisible={Boolean(selected)}
        color={GEN_ACCENT}
        handleStyle={RESIZE_HANDLE_STYLE}
        lineStyle={{ borderWidth: 0 }}
        minWidth={360}
        minHeight={180}
      />

      {selected && (
        <NodeInfoBar
          nodeId={id}
          label={board.label}
          icon={Table2}
          accent={GEN_ACCENT}
          zoom={zoom}
        />
      )}

      <div
        className={cn(
          "flex size-full flex-col rounded-xl border bg-card p-2 shadow-sm",
          selected && "outline outline-1 outline-[#3b82f6]",
        )}
      >
        <StoryboardTable rows={rows} onRowsChange={commit} onExpand={() => setExpanded(true)} />
      </div>

      <StoryboardDialog
        open={expanded}
        onOpenChange={setExpanded}
        title={board.label}
        rows={rows}
        onRowsChange={commit}
      />
    </>
  );
}
