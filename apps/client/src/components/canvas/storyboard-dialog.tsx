"use client";

import type { StoryboardRow } from "@aigc-flow/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StoryboardTable } from "./storyboard-table";

/**
 * 分镜表放大后的弹层：盖住整个画面，里面是同一张表的大号形态
 * （行更高、字号更大），专心填一张表。
 *
 * 和节点里的那份表改的是同一份 rows —— 弹层开着时节点上那份仍然挂载，
 * 两边靠单元格自己的「没聚焦就同步外部值」保持一致（见 storyboard-table.tsx）。
 * 弹层里的表不传 onExpand，免得套娃。
 */
export function StoryboardDialog({
  open,
  onOpenChange,
  title,
  rows,
  onRowsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  rows: StoryboardRow[];
  onRowsChange: (rows: StoryboardRow[]) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 表格比生成菜单宽得多：7 列各自的 min 宽加起来就有 800+，弹层再窄就白放大了 */}
      <DialogContent className="sm:max-w-[min(1200px,92vw)]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            和节点里是同一张表，改完关掉即可。可以从 Excel / Google Sheets 复制一块内容，
            粘到任意格子上会以它为左上角铺开。
          </DialogDescription>
        </DialogHeader>
        {/* 弹层里没有节点那样的确定高度，得自己给一个，表格才有得滚 */}
        <div className="flex h-[65vh] flex-col">
          <StoryboardTable rows={rows} onRowsChange={onRowsChange} large />
        </div>
      </DialogContent>
    </Dialog>
  );
}
