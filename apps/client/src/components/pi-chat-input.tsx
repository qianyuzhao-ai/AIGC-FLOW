"use client";

import type { PiImageAttachment } from "@aigc-flow/shared";
import { ArrowUp, Square, X } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { PiImagePicker } from "@/components/pi-image-picker";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectRuntime } from "@/lib/agent/project-runtime";

export function PiChatInput({
  runtime,
  busy,
  loading,
  error,
}: {
  runtime: ProjectRuntime;
  busy: boolean;
  loading: boolean;
  error: string;
}) {
  const [draft, setDraft] = useState("");
  const [images, setImages] = useState<PiImageAttachment[]>([]);
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
      setImages([]);
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
                {/* biome-ignore lint/performance/noImgElement: 展示用户选中的画布图片。 */}
                <img
                  src={image.url}
                  alt={image.label}
                  className="size-16 rounded-md object-cover"
                />
                <Button
                  type="button"
                  size="icon-xs"
                  variant="secondary"
                  className="absolute top-0 right-0"
                  disabled={loading}
                  aria-label={`移除图片：${image.label}`}
                  onClick={() => setImages(images.filter((item) => item.nodeId !== image.nodeId))}
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
          placeholder="描述你的想法，或选择图片提问…"
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
          <PiImagePicker
            runtime={runtime}
            value={images}
            onChange={setImages}
            disabled={busy || loading}
          />
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
      <p className="text-center text-muted-foreground text-xs">Enter 发送 · Shift+Enter 换行</p>
    </form>
  );
}
