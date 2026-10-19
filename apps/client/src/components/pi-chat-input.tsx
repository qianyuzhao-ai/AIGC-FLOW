"use client";

import {
  MAX_PI_IMAGES,
  type PiImageAttachment,
  type PiSessionInfo,
  type PiSkill,
  type PiThinkingLevel,
} from "@aigc-flow/shared";
import { ArrowUp, BookOpen, Square, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { PiChatStatus } from "@/components/pi-chat-status";
import { PiThumbnail } from "@/components/pi-thumbnail";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectRuntime } from "@/lib/agent/project-runtime";

export function PiChatInput({
  runtime,
  busy,
  loading,
  error,
  images,
  sessionInfo,
  thinkingLevel,
  skills,
}: {
  runtime: ProjectRuntime;
  busy: boolean;
  loading: boolean;
  error: string;
  images: PiImageAttachment[];
  sessionInfo: PiSessionInfo | null;
  thinkingLevel?: PiThinkingLevel;
  skills: PiSkill[];
}) {
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || (!draft.trim() && !images.length)) return;
    try {
      await runtime.send(
        draft.trim() || "请分析这些图片。",
        images.map((image) => image.nodeId),
      );
      setDraft("");
      input.current?.focus({ preventScroll: true });
    } catch {
      // Runtime exposes the error; keep the draft and attachments for retry.
    }
  }
  return (
    <form onSubmit={send} className="shrink-0 space-y-2 border-t p-3">
      {error && (
        <p role="alert" className="text-destructive text-xs">
          {error}
        </p>
      )}
      <div className="rounded-xl border bg-background p-2 shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
        {images.length > 0 && (
          <div className="flex gap-2 overflow-x-auto p-1">
            {images.map((image, index) => (
              <div key={image.nodeId} className="relative w-16 shrink-0">
                <PiThumbnail
                  url={image.url}
                  label={image.label}
                  className="size-16 rounded-md object-cover"
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="secondary"
                  className="absolute top-0 right-0"
                  disabled={loading}
                  aria-label={`移除图片：${image.label}`}
                  onClick={() => runtime.removeChatImage(image.nodeId)}
                >
                  <X />
                </Button>
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {index + 1}. {image.label}
                </p>
              </div>
            ))}
          </div>
        )}
        <label htmlFor={`pi-message-${runtime.projectId}`} className="sr-only">
          发送给 Pi 的消息
        </label>
        <Textarea
          ref={input}
          id={`pi-message-${runtime.projectId}`}
          value={draft}
          disabled={loading}
          maxLength={32000}
          placeholder="描述你的想法，或从画布添加图片…"
          onFocus={() => void runtime.refreshSessionInfo()}
          className="min-h-20 max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            {skills.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={loading}
                    aria-label="使用技能"
                  >
                    <BookOpen />
                    技能
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  side="top"
                  align="start"
                  className="max-h-72 w-72 overflow-y-auto"
                >
                  {skills.map((skill) => (
                    <DropdownMenuItem
                      key={skill.name}
                      className="flex-col items-start"
                      onSelect={() => {
                        setDraft(
                          (current) =>
                            `/skill:${skill.name} ${current.replace(/^\/skill:\S+\s*/, "")}`,
                        );
                        requestAnimationFrame(() => input.current?.focus());
                      }}
                    >
                      <span>{skill.name}</span>
                      <span className="line-clamp-2 text-muted-foreground text-xs">
                        {skill.description}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <span className="px-2 text-muted-foreground text-xs">
              画布选图 · {images.length}/{MAX_PI_IMAGES}
            </span>
          </div>
          {busy ? (
            <Button
              type="button"
              size="icon-sm"
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              variant="outline"
              aria-label="停止回复"
              onClick={() => void runtime.stop()}
            >
              <Square />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon-sm"
              className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
              aria-label="发送消息"
              disabled={loading || (!draft.trim() && !images.length)}
            >
              <ArrowUp />
            </Button>
          )}
        </div>
      </div>
      <PiChatStatus
        info={sessionInfo}
        thinkingLevel={thinkingLevel}
        disabled={busy || loading}
        onThinkingChange={(level) => runtime.setThinkingLevel(level)}
      />
    </form>
  );
}
