"use client";

import {
  type AgentCommandView,
  CANVAS_TOOL_LABELS,
  type GenerationJobView,
  type PiChatMessage,
} from "@aigc-flow/shared";
import { CircleCheck, CircleX, Crosshair, LoaderCircle, Wrench } from "lucide-react";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Message, MessageContent, MessageHeader } from "@/components/ui/message";
import { commandNodeIds } from "@/lib/agent/command-node-ids";

const statuses = {
  pending: "执行中",
  completed: "已完成",
  failed: "失败",
  cancelled: "已停止",
  unknown: "结果未知",
};

function ToolResult({
  command,
  jobs,
  onFocus,
}: {
  command: AgentCommandView;
  jobs: GenerationJobView[];
  onFocus: (ids: string[]) => void;
}) {
  const ids = commandNodeIds(command);
  const results = command.result?.data.results;
  const relatedJobs = Array.isArray(results)
    ? jobs.filter((job) => results.some((result) => result?.id === job.id))
    : [];
  const Icon =
    command.status === "pending"
      ? LoaderCircle
      : command.status === "completed"
        ? CircleCheck
        : command.status === "failed"
          ? CircleX
          : Wrench;
  return (
    <details className="rounded-md border border-border/70 bg-background/50 text-xs">
      <summary className="flex cursor-pointer items-center gap-2 rounded-md p-2 focus-visible:outline-2 focus-visible:outline-ring">
        <Icon
          className={`size-3.5 shrink-0 ${command.status === "pending" ? "motion-safe:animate-spin" : ""}`}
        />
        <span className="min-w-0 flex-1">{CANVAS_TOOL_LABELS[command.name]}</span>
        <span className="shrink-0 text-muted-foreground">{statuses[command.status]}</span>
      </summary>
      <div className="space-y-2 border-t p-2">
        <code className="text-muted-foreground">{command.name}</code>
        <p className="whitespace-pre-wrap">
          {command.result?.message ??
            (command.result?.success
              ? "执行完成"
              : command.status === "pending"
                ? "等待画布回执…"
                : "没有成功回执")}
        </p>
        {command.status === "pending" && command.progress && (
          <p role="status">{command.progress}</p>
        )}
        {ids.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => onFocus(ids)}>
            <Crosshair />
            定位节点 · {ids.length}
          </Button>
        )}
        {relatedJobs.map((job) =>
          job.resultUrl ? (
            <a
              key={job.id}
              className="block underline underline-offset-4"
              href={job.resultUrl}
              target="_blank"
              rel="noreferrer"
            >
              查看{job.kind === "image" ? "图片" : "视频"}结果
            </a>
          ) : null,
        )}
        <details>
          <summary className="cursor-pointer text-muted-foreground">调用参数</summary>
          <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all">
            {JSON.stringify(command.args, null, 2)}
          </pre>
        </details>
      </div>
    </details>
  );
}

export function PiChatMessageRow({
  message,
  partial = "",
  streaming = false,
  commands = message.commands,
  jobs,
  error,
  onFocus,
}: {
  message: PiChatMessage;
  partial?: string;
  streaming?: boolean;
  commands?: AgentCommandView[];
  jobs: GenerationJobView[];
  error?: string | null;
  onFocus: (ids: string[]) => void;
}) {
  const human = message.role === "user";
  const text = [message.text, partial].filter(Boolean).join("\n\n");
  return (
    <Message align={human ? "end" : "start"}>
      <MessageContent>
        <MessageHeader>{human ? "你" : "Pi"}</MessageHeader>
        <Bubble
          variant={human ? "secondary" : "outline"}
          align={human ? "end" : "start"}
          className="max-w-[92%]"
        >
          <BubbleContent className="space-y-3">
            {message.attachments.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {message.attachments.map((image, index) => (
                  <button
                    key={image.nodeId}
                    type="button"
                    className="group min-w-0 rounded-md border bg-background text-left focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => onFocus([image.nodeId])}
                    aria-label={`定位图片 ${index + 1}：${image.label}`}
                  >
                    {/* biome-ignore lint/performance/noImgElement: 画布媒体 URL 使用原始缩略图，不经过 Next 图像代理。 */}
                    <img
                      src={image.url}
                      alt={image.label}
                      loading="lazy"
                      className="aspect-square w-full rounded-t-md object-cover"
                    />
                    <span className="flex items-center gap-1 p-1.5 text-xs text-foreground">
                      <Crosshair className="size-3 shrink-0" />
                      <span className="truncate">
                        {index + 1}. {image.label}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {text && <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>}
            {commands.length > 0 && (
              <section className="space-y-2" aria-label="本轮画布工具">
                {commands.map((command) => (
                  <ToolResult key={command.id} command={command} jobs={jobs} onFocus={onFocus} />
                ))}
              </section>
            )}
            {streaming && (
              <p role="status" className="flex items-center gap-2 text-muted-foreground text-xs">
                <LoaderCircle className="size-3 motion-safe:animate-spin" />
                {text ? "正在回复…" : "Pi 正在处理…"}
              </p>
            )}
            {error && <p className="text-destructive text-xs">{error}</p>}
            {!text && !commands.length && !streaming && !error && (
              <p className="text-muted-foreground text-xs">本轮没有文本回复</p>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  );
}
