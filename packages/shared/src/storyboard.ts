import { z } from "zod";

/** 分镜表节点在 React Flow 里的 node.type */
export const STORYBOARD_NODE_TYPE = "storyboard";

/**
 * 镜头只有三种取值 —— 这是**双人播客**的分镜表，机位是固定的三个：
 * 两个单人特写和一个双人全景。空串表示还没选。
 */
export const SHOT_ROLES = ["单人A", "单人B", "双人"] as const;

export type ShotRole = (typeof SHOT_ROLES)[number];

/** 单镜时长的上下界（秒）。图生视频这一步单段基本落在这个区间里 */
export const DURATION_MIN = 4;
export const DURATION_MAX = 30;

/**
 * 一行分镜。
 *
 * `id` 只是渲染用的稳定 key（React 列表 + 逐格编辑的定位），不跨节点有意义：
 * 复制节点时整份 rows 照抄，两个节点里出现同样的行 id 是正常的。
 *
 * **完整 Prompt 不在这里** —— 它是模板套上表演 Prompt / 台词 / 时长拼出来的
 * 派生值（见 buildFullPrompt），存一份就会和三个变量脱节：改了台词而那一列
 * 还是旧的，而且从表格里看不出来它已经过期了。
 */
export const storyboardRowSchema = z.object({
  id: z.string().min(1),
  /** 镜号。纯手填（"1" / "1A" / "S01-03" 都行），新行留空，系统不插手 */
  shotNumber: z.string(),
  /** 镜头（机位）。三选一，空串 = 还没选 */
  shot: z.union([z.literal(""), z.enum(SHOT_ROLES)]),
  /** 时长（秒），DURATION_MIN..DURATION_MAX。null = 还没填 */
  duration: z.number().min(DURATION_MIN).max(DURATION_MAX).nullable(),
  /** 台词 */
  dialogue: z.string(),
  /** 表演：情绪、动作、走位。 */
  performance: z.string(),
  /** 表演 Prompt：手动填写的表演描述 */
  performancePrompt: z.string(),
});

export type StoryboardRow = z.infer<typeof storyboardRowSchema>;

/** 除 id 外的字段名，也就是表格里可以写进去的那几列 */
export type StoryboardField = Exclude<keyof StoryboardRow, "id">;

/**
 * 单元格的形态。渲染、粘贴解析、能不能写入都按它分叉：
 * - `text` 单行文本，`multiline` 多行文本
 * - `role` 三选一下拉
 * - `seconds` 数字，落在 DURATION_MIN..DURATION_MAX
 * - `derived` 只读派生列，用户改不了、粘贴也写不进去
 */
export type StoryboardCellKind = "text" | "multiline" | "role" | "seconds" | "derived";

/** 派生列的伪字段名。它不在 storyboardRowSchema 里，只在表格和导出时出现 */
export const FULL_PROMPT_KEY = "fullPrompt";

/** 表格里一列的定义。`key` 是 derived 列时不对应任何可写字段 */
export type StoryboardColumn = {
  key: StoryboardField | typeof FULL_PROMPT_KEY;
  label: string;
  kind: StoryboardCellKind;
};

/**
 * 列的顺序、中文名与形态。放 shared 而不是组件里：这既是表头文案、导出表头，
 * 表格渲染和剪贴板导出共用同一份字段清单。
 * 列宽之类的纯排版留在组件里。
 */
export const STORYBOARD_COLUMNS: readonly StoryboardColumn[] = [
  { key: "shotNumber", label: "镜号", kind: "text" },
  { key: "shot", label: "镜头", kind: "role" },
  { key: "duration", label: "时长", kind: "seconds" },
  { key: "dialogue", label: "台词", kind: "multiline" },
  { key: "performance", label: "表演", kind: "multiline" },
  { key: "performancePrompt", label: "表演 Prompt", kind: "multiline" },
  { key: FULL_PROMPT_KEY, label: "完整 Prompt", kind: "derived" },
];

/** 能写进去的列（排掉派生列）。粘贴和逐格编辑都只认这些 */
export const WRITABLE_COLUMNS = STORYBOARD_COLUMNS.filter(
  (column): column is StoryboardColumn & { key: StoryboardField } => column.kind !== "derived",
);

/**
 * 完整 Prompt 的格式模板。三个 `{}` 占位分别换成表演 Prompt、台词、时长。
 *
 * **这是占位文本，不是最终格式** —— 真正的模板由用户给，拿到后改这一处即可
 * （同 video-gen 里 first_last_frame 那条的处置）。做成模板而不是让用户逐行手写：
 * 三个变量随时会改，手写的那一列改完就和上游脱节，而且从表格上看不出它过期了。
 */
export const FULL_PROMPT_TEMPLATE = "{performancePrompt}\n台词：{dialogue}\n时长：{duration}秒";

/**
 * 拼出这一行的完整 Prompt。三个变量缺任何一个都不算错 —— 表还没填完时
 * 这一列就是半成品，照样展示，让人看得见还差什么。
 */
export function buildFullPrompt(row: StoryboardRow): string {
  return FULL_PROMPT_TEMPLATE.replace("{performancePrompt}", row.performancePrompt)
    .replace("{dialogue}", row.dialogue)
    .replace("{duration}", row.duration === null ? "" : String(row.duration));
}

/**
 * 把任意一格读成字符串，供导出和粘贴回填用。派生列现算，
 * 时长的 null 读成空串（导出里空着比写个 "null" 有意义）。
 */
export function cellTextOf(row: StoryboardRow, key: StoryboardColumn["key"]): string {
  if (key === FULL_PROMPT_KEY) return buildFullPrompt(row);
  const value = row[key];
  if (value === null) return "";
  return typeof value === "number" ? String(value) : value;
}

/**
 * 把粘贴进来的一格文本收进对应字段。**类型不对就原样返回不写** ——
 * 从 Excel 贴一列乱七八糟的机位名进来时，宁可那几格空着，
 * 也不能让 shot 里躺着一个三选一之外的值（下拉框会显示成空，人却以为填上了）。
 */
export function coerceCell(row: StoryboardRow, key: StoryboardField, text: string): StoryboardRow {
  if (key === "shot") {
    const trimmed = text.trim();
    if (trimmed === "") return { ...row, shot: "" };
    const matched = SHOT_ROLES.find((role) => role === trimmed);
    return matched ? { ...row, shot: matched } : row;
  }

  if (key === "duration") {
    const trimmed = text.trim();
    if (trimmed === "") return { ...row, duration: null };
    // "12s" / "12 秒" 这类带单位的照收，取里面的数字
    const parsed = Number.parseFloat(trimmed.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(parsed)) return row;
    return { ...row, duration: clampDuration(parsed) };
  }

  return { ...row, [key]: text };
}

/** 把秒数收进合法区间并取整。区间外的值夹住而不是丢弃 —— 用户的意图是明确的 */
export function clampDuration(seconds: number): number {
  return Math.min(Math.max(Math.round(seconds), DURATION_MIN), DURATION_MAX);
}

/**
 * 单个节点的行数上限。整张图是**整体覆盖**写进 projects.graph 一个 JSON 列的，
 * 没有上限时一张表就能把单元格塞爆（同 projectGraphSchema 里节点 / 连线的上限）。
 */
export const STORYBOARD_MAX_ROWS = 200;

export const storyboardNodeDataSchema = z.object({
  label: z.string(),
  rows: z.array(storyboardRowSchema).max(STORYBOARD_MAX_ROWS),
});

export type StoryboardNodeData = z.infer<typeof storyboardNodeDataSchema>;

/** 新建节点时的初始行数，够看出这是张表、又不至于一屏全是空格 */
const INITIAL_ROWS = 3;

/**
 * 行 id 的自增序号。**shared 里不能用 crypto.randomUUID** —— 这个包刻意不带任何
 * 运行环境的类型（tsconfig 的 lib 只有 ES2023，没有 DOM 也没有 node），
 * 前后端和 Electron 都直接吃它的 TS 源码。
 *
 * 后面那截随机串是给「刷新之后」兜底的：序号从 0 重新数，而画布上已有的行
 * 带着上次的 id 从 graph 里读回来，光靠序号会撞。行 id 只需在一张表内唯一。
 */
let rowSeq = 0;

function nextRowId(): string {
  rowSeq += 1;
  return `row-${rowSeq.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createStoryboardRow(): StoryboardRow {
  return {
    id: nextRowId(),
    shotNumber: "",
    shot: "",
    duration: null,
    dialogue: "",
    performance: "",
    performancePrompt: "",
  };
}

/**
 * 新节点的初始 data。**必须是函数，不能是模块级常量** ——
 * 建节点走的 buildCanvasNode 只做浅拷贝（`{ ...defaults }`），
 * 常量的话所有分镜表节点会共用同一个 rows 数组，改一张表另一张跟着变。
 */
export function createStoryboardNodeData(): StoryboardNodeData {
  return {
    label: "双人播客分镜表",
    rows: Array.from({ length: INITIAL_ROWS }, createStoryboardRow),
  };
}

/**
 * 改一个单元格。值一律以文本进来（输入框给的就是文本），由 coerceCell 收进
 * 对应类型。行不存在、或值不合法收不进去时原样返回，调用方据此可跳过写入。
 */
export function withCell(
  rows: StoryboardRow[],
  rowId: string,
  field: StoryboardField,
  value: string,
): StoryboardRow[] {
  const index = rows.findIndex((row) => row.id === rowId);
  const current = rows[index];
  if (!current) return rows;

  const patched = coerceCell(current, field, value);
  if (patched === current) return rows;

  const next = [...rows];
  next[index] = patched;
  return next;
}

/** 在 index 位置插入一个空行（index === rows.length 就是追加）。到上限时原样返回 */
export function withRowInserted(rows: StoryboardRow[], index: number): StoryboardRow[] {
  if (rows.length >= STORYBOARD_MAX_ROWS) return rows;
  const at = Math.min(Math.max(index, 0), rows.length);
  return [...rows.slice(0, at), createStoryboardRow(), ...rows.slice(at)];
}

/**
 * 删掉一行。删到一行不剩时留一个空行 —— 空表没有任何可点的地方，
 * 用户会以为节点坏了（表头下面连个「加一行」的落点都没有）。
 */
export function withRowRemoved(rows: StoryboardRow[], rowId: string): StoryboardRow[] {
  const next = rows.filter((row) => row.id !== rowId);
  if (next.length === rows.length) return rows;
  return next.length > 0 ? next : [createStoryboardRow()];
}

/** 把某一行上移 / 下移一格。已经在头 / 尾时原样返回 */
export function withRowMoved(
  rows: StoryboardRow[],
  rowId: string,
  direction: -1 | 1,
): StoryboardRow[] {
  const from = rows.findIndex((row) => row.id === rowId);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= rows.length) return rows;
  const next = [...rows];
  const moved = next[from];
  const swapped = next[to];
  // noUncheckedIndexedAccess：上面的边界判断已经保证两个都在，这里只是让类型收窄
  if (!moved || !swapped) return rows;
  next[from] = swapped;
  next[to] = moved;
  return next;
}

/** 分镜表节点的初始尺寸。可自由拉伸，尺寸随 graph 落盘（同文本节点） */
export const STORYBOARD_NODE_WIDTH = 880;
export const STORYBOARD_NODE_HEIGHT = 320;

/**
 * 解析从 Excel / Google Sheets（以及多数表格工具）复制来的剪贴板文本。
 *
 * 两家放进 `text/plain` 的都是 **TSV**：列用 `\t` 分、行用换行分，而**含制表符、
 * 换行或引号的单元格会被 `"` 包起来、内部引号翻倍**（和 CSV 一个规矩）。
 * 台词和完整 Prompt 这两列很容易是多行的，所以不能简单 `split("\t")` ——
 * 那样一格里的换行会被当成换行，一行内容散成好几行。
 *
 * 返回的是剪贴板里的原始形状（几行几列），要不要截断、往哪落由调用方决定。
 * 空文本返回 `[[""]]`（一个空格子），调用方按 1×1 处理即可，不用特判。
 */
export function parseClipboardTable(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  /** 正在引号里面。此时制表符和换行都是内容，不是分隔符 */
  let quoted = false;
  /** 字段刚开始。只有开头的引号才算「包裹」，中间出现的引号是普通字符 */
  let atFieldStart = true;
  let i = 0;

  while (i < text.length) {
    const ch = text[i] ?? "";

    if (quoted) {
      if (ch === '"') {
        // 连着两个引号是转义出来的一个引号，不是结束
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (atFieldStart && ch === '"') {
      quoted = true;
      atFieldStart = false;
      i += 1;
      continue;
    }

    if (ch === "\t") {
      row.push(field);
      field = "";
      atFieldStart = true;
      i += 1;
      continue;
    }

    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      atFieldStart = true;
      rows.push(row);
      row = [];
      // Windows 的 Excel 给的是 \r\n，两个字符算一个换行
      i += ch === "\r" && text[i + 1] === "\n" ? 2 : 1;
      continue;
    }

    field += ch;
    atFieldStart = false;
    i += 1;
  }

  // 收尾。文本以换行结尾时这里 field 和 row 都是空的 —— 那是分隔符的尾巴，
  // 不是一个空行，补上去的话每次粘贴都会多出一行
  if (field !== "" || row.length > 0 || rows.length === 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

/**
 * 把一块（几行几列）内容按 Excel 的语义贴进表里：以 `anchorIndex` 行、
 * `anchorField` 列为左上角向右下铺开，覆盖沿途的格子。
 *
 * - 行不够就补空行，补到 `STORYBOARD_MAX_ROWS` 为止，**超出的行直接丢弃**
 * - 超出最右一列的内容丢弃（列是固定的，不会因为粘贴而长出新列）
 * - 落到派生列（完整 Prompt）上的内容丢弃，它是算出来的、写不进去
 * - 落到镜头 / 时长上的内容按各自的类型收（见 coerceCell），收不进去就空着
 *
 * 调用方要提示「丢了多少」的话自己按 `STORYBOARD_MAX_ROWS` 算，
 * 这里只管落数据，不返回统计 —— 返回值的形状越简单越好接。
 */
export function withBlockPasted(
  rows: StoryboardRow[],
  anchorIndex: number,
  anchorField: StoryboardField,
  block: string[][],
): StoryboardRow[] {
  const anchorColumn = STORYBOARD_COLUMNS.findIndex((column) => column.key === anchorField);
  if (anchorColumn < 0 || block.length === 0) return rows;

  const next = [...rows];
  const wanted = Math.min(anchorIndex + block.length, STORYBOARD_MAX_ROWS);
  while (next.length < wanted) next.push(createStoryboardRow());

  for (const [offset, line] of block.entries()) {
    const target = next[anchorIndex + offset];
    // 越过上限的行：上面没补出来，这里跳过
    if (!target) continue;

    let patched = target;
    for (const [column, value] of line.entries()) {
      const definition = STORYBOARD_COLUMNS[anchorColumn + column];
      // 越过最右一列、或落在只读的派生列上：丢弃
      if (!definition || definition.kind === "derived") continue;
      patched = coerceCell(patched, definition.key as StoryboardField, value);
    }
    next[anchorIndex + offset] = patched;
  }

  return next;
}

/** 单元格含分隔符或引号时要按 TSV 的规矩包起来，否则粘回表格工具会散架 */
function escapeClipboardCell(value: string): string {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 把整张表（含表头）写成 TSV，直接粘进 Excel / Google Sheets 就是一张表。
 * 完整 Prompt 那一列导出的是**算出来的当前值**，和表格上看到的一致。
 * 行分隔用 `\r\n`：Windows 版 Excel 只认这个，其余工具两种都收。
 */
export function toClipboardTable(rows: StoryboardRow[]): string {
  const header = STORYBOARD_COLUMNS.map((column) => column.label);
  const body = rows.map((row) => STORYBOARD_COLUMNS.map((column) => cellTextOf(row, column.key)));

  return [header, ...body].map((line) => line.map(escapeClipboardCell).join("\t")).join("\r\n");
}

/**
 * 失焦时把格子里的文本收成规范形态，让 DOM 显示的和存下去的一致。
 *
 * 只有 seconds 需要它，但坑值得说清楚：时长每敲一下都会经 coerceCell 夹进
 * 4..30，而输入框由本地 draft 驱动、聚焦期间不接收外部回流 —— 用户想输 50，
 * 敲完数据里是 30、格子里还显示着 50，失焦也不会自己对齐（value 没变，
 * 同步的 effect 不会重跑）。所以失焦时得由这里给出规范文本再写回 draft。
 */
export function normalizeCellText(kind: StoryboardCellKind, text: string): string {
  if (kind !== "seconds") return text;

  const trimmed = text.trim();
  if (trimmed === "") return "";
  const parsed = Number.parseFloat(trimmed.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? String(clampDuration(parsed)) : "";
}

/**
 * 把从 graph 读回来的行收成当前契约的形状。
 *
 * 列的语义改过一轮（镜号从行序号变成手填、镜头从自由文本变成三选一、
 * 时长从字符串变成数字），而 **node data 是不过 zod 的** —— canvasNodeSchema 的
 * data 是 `catchall(z.unknown())`，旧节点会原样带着 `duration: "3s"` 这类值回来。
 * 光靠渲染时兜底不够：这些值会被原样塞进生成请求，zValidator 一看类型不对就 400，
 * 而那个错误体里没有 message 字段，前端只能弹一个没有原因的「失败」。
 *
 * **没有任何一行需要改时返回原数组**，调用方可以直接 useMemo 缓存，
 * 不会因为读一次就判定成有改动去存盘。
 */
export function normalizeStoryboardRows(rows: StoryboardRow[]): StoryboardRow[] {
  let changed = false;

  const next = rows.map((row) => {
    const duration =
      typeof row.duration === "number" && Number.isFinite(row.duration)
        ? clampDuration(row.duration)
        : null;
    // 三选一之外的旧值（"中景，女主推门而入" 之类）只能丢 —— 新列容不下它，
    // 留着的话下拉显示为空、数据里却有值，是最难查的那种不一致
    const shot: ShotRole | "" = SHOT_ROLES.find((role) => role === row.shot) ?? "";
    const shotNumber = typeof row.shotNumber === "string" ? row.shotNumber : "";

    if (duration === row.duration && shot === row.shot && shotNumber === row.shotNumber) {
      return row;
    }
    changed = true;
    return { ...row, shotNumber, shot, duration };
  });

  return changed ? next : rows;
}
