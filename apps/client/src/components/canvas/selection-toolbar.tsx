"use client";

import { NODE_MARK_LABEL, type NodeMark } from "@aigc-flow/shared";
import { NodeToolbar, Position } from "@xyflow/react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Check,
  ChevronDown,
  Download,
  Eraser,
  Group,
  LayoutGrid,
  MessageSquarePlus,
  Tag,
  Ungroup,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { type AlignMode, DISTRIBUTE_MIN, type SpacingMode } from "@/lib/layout";

/**
 * 排布与批量操作至少需要两个节点。单张图片仍显示「添加到 chat」。
 */
export const SELECTION_TOOLBAR_MIN = 2;

const ALIGN_ITEMS: Array<{ mode: AlignMode; label: string; icon: typeof AlignStartVertical }> = [
  { mode: "left", label: "左对齐", icon: AlignStartVertical },
  { mode: "centerX", label: "水平居中", icon: AlignCenterVertical },
  { mode: "right", label: "右对齐", icon: AlignEndVertical },
  { mode: "top", label: "顶部对齐", icon: AlignStartHorizontal },
  { mode: "centerY", label: "垂直居中", icon: AlignCenterHorizontal },
  { mode: "bottom", label: "底部对齐", icon: AlignEndHorizontal },
];

/** 等距分布两档：两端固定、中间摊开，所以至少要 3 个（DISTRIBUTE_MIN） */
const SPACING_ITEMS: Array<{ mode: SpacingMode; label: string; icon: typeof AlignStartVertical }> =
  [
    { mode: "distributeX", label: "水平等距分布", icon: AlignHorizontalSpaceAround },
    { mode: "distributeY", label: "垂直等距分布", icon: AlignVerticalSpaceAround },
  ];

type SelectionToolbarProps = {
  selectedIds: string[];
  chatImageCount: number;
  onAddToChat: () => void;
  /** 选区正好是一个编组时的编组 id，工具条据此切到「解组」形态 */
  groupId: string | null;
  /** 选区能不能编组。不能的原因只有一个：里面已经有编组或组内节点（暂不支持嵌套） */
  canGroup: boolean;
  onGroup: () => void;
  onUngroup: () => void;
  onArrange: () => void;
  onAlign: (mode: AlignMode) => void;
  onSpace: (mode: SpacingMode) => void;
  onDownload: () => void;
  /** 选区里能下载的素材数量。普通节点和还没传完的媒体不算 */
  downloadCount: number;
  /** 给选区里的素材批量打标（null 清除），选中编组时作用于组内成员 */
  onMark: (mark: NodeMark | null) => void;
  /** 选区里能打标的素材数量，判据和下载一样：身上得有素材 */
  markCount: number;
};

const MARK_ITEMS: Array<{ mark: NodeMark | null; label: string; icon: typeof Check }> = [
  { mark: "keep", label: NODE_MARK_LABEL.keep, icon: Check },
  { mark: "reject", label: NODE_MARK_LABEL.reject, icon: X },
  { mark: null, label: "清除标记", icon: Eraser },
];

/**
 * 浮在选区上方的操作条；单张图片提供聊天附件入口。
 *
 * 位置交给 React Flow 的 NodeToolbar：传一组 nodeId 进去，它会自己算这批节点的
 * 包围盒并跟着缩放 / 平移走，不用我们自己把画布坐标换算成屏幕坐标。
 * offset 要躲开节点自己的信息条（在节点上方 24px 处）。
 */
export function SelectionToolbar({
  selectedIds,
  chatImageCount,
  onAddToChat,
  groupId,
  canGroup,
  onGroup,
  onUngroup,
  onArrange,
  onAlign,
  onSpace,
  onDownload,
  downloadCount,
  onMark,
  markCount,
}: SelectionToolbarProps) {
  // 编组提供解组操作，多选普通节点提供排布操作。
  const isGroup = groupId !== null;
  if (!isGroup && selectedIds.length < SELECTION_TOOLBAR_MIN && chatImageCount === 0) return null;

  return (
    <NodeToolbar
      nodeId={selectedIds}
      isVisible
      position={Position.Top}
      offset={36}
      className="flex items-center gap-0.5 rounded-xl border bg-background/90 p-1 shadow-lg backdrop-blur-sm"
    >
      {chatImageCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onAddToChat}>
          <MessageSquarePlus />
          添加到 chat{chatImageCount > 1 ? ` · ${chatImageCount}` : ""}
        </Button>
      )}
      {(isGroup || selectedIds.length >= SELECTION_TOOLBAR_MIN) && (
        <>
          {isGroup ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={onUngroup}>
                  <Ungroup />
                  解组
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">拆掉编组，成员留在原地</TooltipContent>
            </Tooltip>
          ) : (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={onArrange}>
                    <LayoutGrid />
                    整理节点
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">按阅读顺序重排成等距网格</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  {/* disabled 的按钮不派发鼠标事件，tooltip 收不到 hover，套一层 span 承接 */}
                  <span className="inline-flex">
                    <Button variant="ghost" size="sm" disabled={!canGroup} onClick={onGroup}>
                      <Group />
                      创建编组
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {canGroup ? "把选中的节点框成一组" : "选区里含编组或组内节点，暂不支持嵌套编组"}
                </TooltipContent>
              </Tooltip>

              <Separator orientation="vertical" className="!h-5 !self-center mx-1" />

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="对齐方式">
                    <AlignStartVertical />
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" side="top" className="min-w-40">
                  {ALIGN_ITEMS.map(({ mode, label, icon: Icon }) => (
                    <DropdownMenuItem
                      key={mode}
                      onSelect={() => onAlign(mode)}
                      className="whitespace-nowrap"
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    {/* 两档都要求至少 3 个，不够时整个按钮置灰；disabled 不派发鼠标事件，套 span 承接 tooltip */}
                    <span className="inline-flex">
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={selectedIds.length < DISTRIBUTE_MIN}
                          aria-label="等距分布"
                        >
                          <AlignHorizontalSpaceAround />
                          <ChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {selectedIds.length < DISTRIBUTE_MIN
                      ? `等距分布至少要选 ${DISTRIBUTE_MIN} 个节点`
                      : "等距分布"}
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="center" side="top" className="min-w-40">
                  {SPACING_ITEMS.map(({ mode, label, icon: Icon }) => (
                    <DropdownMenuItem
                      key={mode}
                      onSelect={() => onSpace(mode)}
                      className="whitespace-nowrap"
                    >
                      <Icon />
                      {label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}

          <Separator orientation="vertical" className="!h-5 !self-center mx-1" />

          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={markCount === 0}
                      aria-label="批量标记"
                    >
                      <Tag />
                      <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">
                {markCount === 0 ? "选区里没有可标记的素材" : `标记 ${markCount} 个素材`}
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="center" side="top" className="min-w-40">
              {MARK_ITEMS.map(({ mark, label, icon: Icon }) => (
                <DropdownMenuItem
                  key={label}
                  onSelect={() => onMark(mark)}
                  className="whitespace-nowrap"
                >
                  <Icon />
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              {/* disabled 的按钮不派发鼠标事件，tooltip 收不到 hover，套一层 span 承接 */}
              <span className="inline-flex">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={downloadCount === 0}
                  onClick={onDownload}
                  aria-label="批量下载"
                >
                  <Download />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {downloadCount === 0 ? "选区里没有可下载的素材" : `批量下载 ${downloadCount} 个素材`}
            </TooltipContent>
          </Tooltip>
        </>
      )}
    </NodeToolbar>
  );
}
