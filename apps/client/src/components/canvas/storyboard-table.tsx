"use client";

import {
  cellTextOf,
  DURATION_MAX,
  DURATION_MIN,
  normalizeCellText,
  parseClipboardTable,
  SHOT_ROLES,
  STORYBOARD_COLUMNS,
  STORYBOARD_MAX_ROWS,
  type StoryboardCellKind,
  type StoryboardColumn,
  type StoryboardField,
  type StoryboardRow,
  toClipboardTable,
  withBlockPasted,
  withCell,
  withRowInserted,
  withRowMoved,
  withRowRemoved,
} from "@aigc-flow/shared";
import {
  ArrowDown,
  ArrowUp,
  ClipboardCopy,
  Maximize2,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * 每列多宽。列的顺序、中文名和形态（text / role / seconds / derived）都在
 * shared 的 STORYBOARD_COLUMNS 里；
 * 这里只管排版。
 *
 * 宽度用 minmax：节点可以拉窄，窄到 min 之后整张表横向滚动，
 * 而不是把「完整 Prompt」挤成一个字一行。
 */
const COLUMN_WIDTHS: Record<StoryboardColumn["key"], string> = {
  shotNumber: "64px",
  shot: "96px",
  duration: "72px",
  dialogue: "minmax(120px, 1.4fr)",
  performance: "minmax(120px, 1.4fr)",
  performancePrompt: "minmax(140px, 1.6fr)",
  fullPrompt: "minmax(160px, 1.8fr)",
};

/** 各内容列 + 行操作列 */
const GRID_TEMPLATE = [
  ...STORYBOARD_COLUMNS.map((column) => COLUMN_WIDTHS[column.key]),
  "36px",
].join(" ");

/** 各列 min 宽之和。低于这个宽度就横向滚动，不再压缩 */
const MIN_TABLE_WIDTH = 808;

type StoryboardTableProps = {
  rows: StoryboardRow[];
  onRowsChange: (rows: StoryboardRow[]) => void;
  /** 放大弹层里用：行更高、字号更大，一屏能读完一整段提示词 */
  large?: boolean;
  /**
   * 给了就在页脚右侧露出「放大」按钮，点了由节点把整张表放进弹层。
   * 弹层里的那份不传，免得套娃（同 prompt-editor 的做法）。
   */
  onExpand?: () => void;
};

/**
 * 分镜表的表格主体。节点里和放大弹层里是同一个组件的两份实例，
 * 改的是同一份 rows —— 所以单元格必须能接收外部改动（见 StoryboardCell 的同步守卫）。
 */
export function StoryboardTable({
  rows,
  onRowsChange,
  large = false,
  onExpand,
}: StoryboardTableProps) {
  const atMax = rows.length >= STORYBOARD_MAX_ROWS;

  /**
   * 从 Excel / Google Sheets 粘进来的一整块内容：以被粘的那个格子为左上角铺开。
   * 丢弃的部分（超出 200 行上限、超出最右一列、落在只读的完整 Prompt 上、
   * 机位不是三个合法值之一）要说出来 —— 悄悄少一截比直接失败更难发现。
   */
  function pasteBlock(anchorIndex: number, field: StoryboardField, block: string[][]) {
    onRowsChange(withBlockPasted(rows, anchorIndex, field, block));

    const columns = Math.max(...block.map((line) => line.length));
    const anchorColumn = STORYBOARD_COLUMNS.findIndex((column) => column.key === field);
    const droppedRows = Math.max(0, anchorIndex + block.length - STORYBOARD_MAX_ROWS);
    const droppedColumns = Math.max(0, anchorColumn + columns - STORYBOARD_COLUMNS.length);
    // 落在派生列上的那一列写不进去，单独说 —— 它在表内，不属于「超出右边界」
    const hitDerived = anchorColumn + columns > STORYBOARD_COLUMNS.length - 1;
    const notes = [
      droppedRows > 0 ? `超出 ${STORYBOARD_MAX_ROWS} 行上限的 ${droppedRows} 行已丢弃` : "",
      droppedColumns > 0 ? `右侧放不下的 ${droppedColumns} 列已丢弃` : "",
      hitDerived ? "「完整 Prompt」是算出来的，落在它上面的内容没写入" : "",
    ].filter(Boolean);

    toast.success(`已粘贴 ${block.length} 行 × ${columns} 列`, {
      description: notes.length > 0 ? notes.join("；") : undefined,
    });
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(toClipboardTable(rows));
      toast.success(`已复制 ${rows.length} 行`, {
        description: "含表头，可直接粘进 Excel / Google Sheets",
      });
    } catch {
      // 剪贴板 API 要安全上下文 + 用户手势，被拒时说清楚，别让人以为表格坏了
      toast.error("复制失败", { description: "浏览器不允许写入剪贴板" });
    }
  }

  return (
    <div className="flex size-full min-h-0 flex-col">
      {/*
        只挂 nowheel（表格自己滚，不缩放画布），**不挂 nodrag** ——
        整块挂上的话 880px 宽的节点只剩四周 8px 的边能拖走。
        真正需要 nodrag 的是输入框、下拉和按钮，它们各自挂了；
        表头、行下面的空白照旧可以拖动节点。
      */}
      <div className="nowheel min-h-0 flex-1 overflow-auto rounded-md border">
        <div
          className="grid"
          style={{ gridTemplateColumns: GRID_TEMPLATE, minWidth: MIN_TABLE_WIDTH }}
        >
          {STORYBOARD_COLUMNS.map((column) => (
            <HeaderCell key={column.key}>{column.label}</HeaderCell>
          ))}
          {/* 行操作列的表头留空：一个 36px 宽的「操作」二字只会被截断 */}
          <HeaderCell className="border-r-0" />

          {rows.map((row, index) => (
            <Row
              key={row.id}
              row={row}
              index={index}
              rowCount={rows.length}
              large={large}
              rows={rows}
              onRowsChange={onRowsChange}
              onPasteBlock={pasteBlock}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 pt-1.5">
        <Button
          variant="ghost"
          size="sm"
          className="nodrag h-7 gap-1 px-2 text-xs"
          disabled={atMax}
          onClick={() => onRowsChange(withRowInserted(rows, rows.length))}
        >
          <Plus className="size-3.5" />
          添加一行
        </Button>

        <span className="text-[11px] text-muted-foreground tabular-nums">
          共 {rows.length} 镜{atMax ? `（已达上限 ${STORYBOARD_MAX_ROWS}）` : ""}
        </span>

        <Button
          variant="ghost"
          size="sm"
          className="nodrag ml-auto h-7 gap-1 px-2 text-muted-foreground text-xs"
          onClick={copyAll}
        >
          <ClipboardCopy className="size-3.5" />
          复制全表
        </Button>

        {onExpand && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="放大编辑"
            title="放大编辑"
            onClick={onExpand}
            className="nodrag text-muted-foreground"
          >
            <Maximize2 />
          </Button>
        )}
      </div>
    </div>
  );
}

function HeaderCell({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        // sticky 让表头在纵向滚动时留在原地；bg-card 不能少，否则内容会从底下透上来
        "sticky top-0 z-10 border-r border-b bg-card px-2 py-1.5 font-medium text-[11px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 一行的所有格子。grid 是扁平的，这里直接吐出同级的若干个 cell */
function Row({
  row,
  rows,
  index,
  rowCount,
  large,
  onRowsChange,
  onPasteBlock,
}: {
  row: StoryboardRow;
  rows: StoryboardRow[];
  index: number;
  rowCount: number;
  large: boolean;
  onRowsChange: (rows: StoryboardRow[]) => void;
  onPasteBlock: (anchorIndex: number, field: StoryboardField, block: string[][]) => void;
}) {
  return (
    <>
      {STORYBOARD_COLUMNS.map((column) => (
        <Cell
          key={column.key}
          column={column}
          row={row}
          large={large}
          onCommit={(value) =>
            onRowsChange(withCell(rows, row.id, column.key as StoryboardField, value))
          }
          onPasteBlock={(block) => onPasteBlock(index, column.key as StoryboardField, block)}
        />
      ))}

      <div className="flex items-start justify-center border-b py-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="nodrag size-6"
              aria-label={`第 ${index + 1} 行的操作`}
            >
              <MoreHorizontal className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              disabled={index === 0}
              onSelect={() => onRowsChange(withRowMoved(rows, row.id, -1))}
            >
              <ArrowUp />
              上移
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === rowCount - 1}
              onSelect={() => onRowsChange(withRowMoved(rows, row.id, 1))}
            >
              <ArrowDown />
              下移
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRowsChange(withRowInserted(rows, index + 1))}>
              <Plus />
              在下方插入
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => onRowsChange(withRowRemoved(rows, row.id))}
            >
              <Trash2 />
              删除本行
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </>
  );
}

/** 按列的形态分派到具体的单元格实现。边框统一画在这一层的外壳上 */
function Cell({
  column,
  row,
  large,
  onCommit,
  onPasteBlock,
}: {
  column: StoryboardColumn;
  row: StoryboardRow;
  large: boolean;
  onCommit: (value: string) => void;
  onPasteBlock: (block: string[][]) => void;
}) {
  const text = cellTextOf(row, column.key);

  if (column.kind === "derived") {
    return (
      <div
        className={cn(
          "select-text whitespace-pre-wrap break-words border-r border-b px-2 py-1.5",
          // 派生列压暗一档，一眼看出「这列不用填」
          "bg-muted/30 text-muted-foreground",
          large ? "text-sm" : "text-xs",
        )}
      >
        {text}
      </div>
    );
  }

  if (column.kind === "role") {
    return (
      <div className="flex border-r border-b p-1">
        <Select value={row.shot} onValueChange={onCommit}>
          <SelectTrigger
            size="sm"
            className={cn(
              // 表格里的下拉要看起来像格子的一部分：去边框、撑满、字号跟随
              "nodrag h-auto w-full self-start border-none bg-transparent px-1 py-0.5 shadow-none dark:bg-transparent dark:hover:bg-accent/40",
              large ? "text-sm" : "text-xs",
            )}
          >
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {SHOT_ROLES.map((role) => (
              <SelectItem key={role} value={role}>
                {role}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <StoryboardCell
      value={text}
      kind={column.kind}
      large={large}
      onCommit={onCommit}
      onPasteBlock={onPasteBlock}
    />
  );
}

/**
 * 一个可编辑单元格（文本 / 多行 / 秒数）。
 *
 * 值由本地 draft 驱动，不直接绑 node data —— 中文输入法的老坑（见 CLAUDE.md 与
 * text-node.tsx）：值绕经 React Flow 的 store 再回流是滞后的，React 发现 value
 * 和 DOM 对不上就会写回去，而组词过程中改写 value 会摧毁 composition 区，
 * 「中文」会打成 zzhzhozhonzhong中wwewen文。
 *
 * 和文本节点不同的是这里的输入框**常驻**（表格没有「双击进编辑」这一步），
 * 所以外部改动要能同步进来：撤销、粘贴，以及放大弹层和
 * 节点里两份表格同时挂载时在另一份里改了同一格。同步只在**没聚焦**时做 ——
 * 聚焦时写回正是要避开的那件事。
 */
function StoryboardCell({
  value,
  kind,
  large,
  onCommit,
  onPasteBlock,
}: {
  value: string;
  kind: StoryboardCellKind;
  large: boolean;
  onCommit: (value: string) => void;
  onPasteBlock: (block: string[][]) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  /** 写回节点。组词中间态不写 —— 拼音会顺着落盘跑进 graph */
  function flush(next: string) {
    setDraft(next);
    if (!composingRef.current) onCommit(next);
  }

  const shared = {
    value: draft,
    onChange: (event: { target: { value: string } }) => flush(event.target.value),
    onFocus: () => {
      focusedRef.current = true;
    },
    onCompositionStart: () => {
      composingRef.current = true;
    },
    // compositionend 和最后那次 input 的先后顺序各浏览器不一致，两头都写一次，
    // 先落地的那次生效，另一次是同值幂等
    onCompositionEnd: (event: { currentTarget: { value: string } }) => {
      composingRef.current = false;
      flush(event.currentTarget.value);
    },
    onBlur: (event: { currentTarget: { value: string } }) => {
      // 组词没结束就失焦（点了别处）时，把已经上屏的部分收下
      composingRef.current = false;
      focusedRef.current = false;
      // 规范化后再写：时长每敲一下就被夹进 4..30，而聚焦期间 draft 不接收回流，
      // 想输 50 的话数据里是 30、格子里还显示 50，失焦也不会自己对齐
      flush(normalizeCellText(kind, event.currentTarget.value));
    },
    /**
     * 从 Excel / Google Sheets 粘一块内容进来时，以本格为左上角铺开（见 pasteBlock）。
     * 参数写成结构类型而不是 React.ClipboardEvent<…>：这个对象要同时喂给
     * <input> 和 <textarea>，两边的事件泛型不一样，结构类型两边都接得住。
     */
    onPaste: (event: {
      clipboardData: DataTransfer;
      preventDefault: () => void;
      currentTarget: { selectionStart: number | null; selectionEnd: number | null };
    }) => {
      const text = event.clipboardData.getData("text/plain");
      const block = parseClipboardTable(text);
      const only = block.length === 1 && block[0]?.length === 1 ? block[0][0] : null;

      // 解析前后一模一样 = 就是一段没有分隔符的普通文本，交给浏览器默认行为
      // （在光标处插入、保留撤销栈），别自己动手
      if (only === text) return;

      event.preventDefault();

      if (only !== null && only !== undefined) {
        // 单格但带了引号包裹（内容里有换行或制表符）。仍然按光标位置插入，
        // 而不是整格替换 —— 用户的心智是「粘一段文字」，不是「换掉这一格」
        const start = event.currentTarget.selectionStart ?? draft.length;
        const end = event.currentTarget.selectionEnd ?? start;
        flush(draft.slice(0, start) + only + draft.slice(end));
        return;
      }

      // 本格就是这块的左上角，它自己的新值必须**在这里**落进 draft：
      // 粘贴时本格是聚焦的，上面那条「聚焦时不同步外部值」的守卫会挡掉回流，
      // 于是数据已经换成新值、格子里还显示着旧的 —— 接着一打字，
      // flush 就把陈旧的 draft 写回去，刚粘进来的内容被悄悄冲掉。
      // 只 setDraft 不 flush：数据由 onPasteBlock 整块写，这里再写一次会拿旧的
      // rows 闭包去覆盖它。
      setDraft(block[0]?.[0] ?? "");
      onPasteBlock(block);
    },
    className: cn(
      "nodrag w-full resize-none bg-transparent px-2 py-1.5 outline-none",
      "placeholder:text-muted-foreground/50 focus:bg-accent/40 disabled:opacity-60",
      large ? "text-sm" : "text-xs",
      // 单行输入不跟着行高拉伸，否则一行里多行格子撑高之后，
      // 数字会被垂直居中到半空，和旁边顶部对齐的格子错开
      kind === "multiline" ? "h-full" : "self-start",
    ),
  };

  return (
    // 边框画在外壳上而不是输入框上：输入框的高度不一定等于行高（见上面的 self-start），
    // 画在它身上的话竖线会断成一截一截
    <div className="flex border-r border-b">
      {kind === "multiline" ? (
        <textarea {...shared} rows={large ? 4 : 2} />
      ) : (
        <input
          {...shared}
          // 秒数用 number：手机 / 触控板上直接出数字键盘，也带上下微调
          type={kind === "seconds" ? "number" : "text"}
          min={kind === "seconds" ? DURATION_MIN : undefined}
          max={kind === "seconds" ? DURATION_MAX : undefined}
          step={kind === "seconds" ? 1 : undefined}
          placeholder={kind === "seconds" ? `${DURATION_MIN}-${DURATION_MAX}` : undefined}
        />
      )}
    </div>
  );
}
