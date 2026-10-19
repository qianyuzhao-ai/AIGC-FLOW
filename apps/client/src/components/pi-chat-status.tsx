"use client";

import { type PiSessionInfo, type PiThinkingLevel, piThinkingLevelSchema } from "@aigc-flow/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const labels: Record<PiThinkingLevel, string> = {
  off: "关闭",
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
};
export function PiChatStatus({
  info,
  thinkingLevel,
  disabled,
  onThinkingChange,
}: {
  info: PiSessionInfo | null;
  thinkingLevel?: PiThinkingLevel;
  disabled: boolean;
  onThinkingChange: (level: PiThinkingLevel) => void;
}) {
  const modelName = info ? (info.model?.name ?? "未配置模型") : "读取模型中…";
  const context = info?.context;
  return (
    <div className="flex flex-wrap items-center gap-2 text-muted-foreground text-xs">
      <output
        className="min-w-0 flex-1 truncate"
        aria-label={`当前模型：${modelName}`}
        title={info?.model ? `${info.model.provider} / ${info.model.id}` : modelName}
      >
        {modelName}
      </output>
      {context && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-1.5 text-muted-foreground text-xs tabular-nums"
              aria-label="上下文用量"
            >
              {context.percent === null ? "上下文未知" : `上下文 ${context.percent.toFixed(1)}%`}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-64">
            <p className="font-medium">上下文用量（估算）</p>
            <p className="text-muted-foreground text-xs">
              {context.tokens === null
                ? "当前用量暂不可用"
                : `${context.tokens.toLocaleString()} / ${context.contextWindow.toLocaleString()} tokens`}
            </p>
            <progress
              aria-label="上下文已使用比例"
              max={100}
              value={context.percent === null ? undefined : Math.min(100, context.percent)}
              className="h-1.5 w-full accent-foreground"
            />
            <p className="text-muted-foreground text-xs">由 Pi 根据会话估算，回复完成后更新。</p>
          </PopoverContent>
        </Popover>
      )}
      {info && info.thinkingLevels.length > 1 && (
        <Select
          value={thinkingLevel ?? info.thinkingLevel}
          disabled={disabled}
          onValueChange={(value) => onThinkingChange(piThinkingLevelSchema.parse(value))}
        >
          <SelectTrigger
            size="sm"
            className="h-7 gap-1 border-0 px-1.5 text-xs shadow-none"
            aria-label="思考程度"
          >
            <span>思考</span>
            <SelectValue />
          </SelectTrigger>
          <SelectContent side="top" align="end">
            {info.thinkingLevels.map((level) => (
              <SelectItem key={level} value={level}>
                {labels[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
