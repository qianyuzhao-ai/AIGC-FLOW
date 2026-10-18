"use client";

import { CANVAS_TOOL_LABELS } from "@aigc-flow/shared";
import { Bot, Square, X } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import {
  type FormEvent,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useProjectAgent } from "@/components/agent-workspace";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CanvasPortalContext } from "@/lib/desktop";
import { cn } from "@/lib/utils";

export function piChatTransition(open: boolean, reducedMotion: boolean | null) {
  return {
    duration: reducedMotion ? 0 : open ? 0.25 : 0.18,
    ease: [0.32, 0.72, 0, 1] as const,
  };
}

export function PiChat({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mounted, setMounted] = useState(false);
  const container = useContext(CanvasPortalContext);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => setMounted(true), []);
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="icon"
        aria-label="打开 Pi 对话"
        aria-expanded={open}
        aria-controls={`pi-chat-panel-${projectId}`}
        onClick={() => onOpenChange(!open)}
      >
        <Bot />
      </Button>
      {mounted &&
        createPortal(
          <div
            className={cn(
              "pointer-events-none inset-0 z-30 overflow-hidden",
              container ? "absolute" : "fixed",
            )}
          >
            <AnimatePresence initial={false}>
              {open && (
                <PiChatPanel
                  key={projectId}
                  projectId={projectId}
                  onClose={() => {
                    onOpenChange(false);
                    trigger.current?.focus({ preventScroll: true });
                  }}
                />
              )}
            </AnimatePresence>
          </div>,
          container ?? document.body,
        )}
    </>
  );
}

function PiChatPanel({ projectId, onClose }: { projectId: number; onClose: () => void }) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const runtime = useProjectAgent(projectId);
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const { messages, loading, error, commands, jobs } = state;
  const busy = state.run?.status === "running";
  const partial = state.run?.partial ?? "";
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  useEffect(() => {
    if (isPresent) {
      void runtime.load();
      input.current?.focus({ preventScroll: true });
    }
  }, [runtime, isPresent]);
  useEffect(() => {
    if ((messages.length || partial || commands.length) && follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, partial, commands]);
  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !draft.trim()) return;
    try {
      await runtime.send(draft.trim());
      setDraft("");
      follow.current = true;
    } catch {
      /* 错误由项目运行时展示，保留草稿供重试。 */
    }
  }
  const stop = () => {
    void runtime.stop();
  };

  return (
    <motion.aside
      id={`pi-chat-panel-${projectId}`}
      aria-label="Pi 对话"
      aria-hidden={!isPresent}
      inert={!isPresent}
      initial={{ x: reducedMotion ? 0 : "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%", transition: piChatTransition(false, reducedMotion) }}
      transition={piChatTransition(true, reducedMotion)}
      className="pointer-events-auto absolute inset-y-0 right-0 flex w-(--pi-chat-width) flex-col border-l bg-background shadow-lg"
    >
      <div className="flex items-center justify-between border-b p-3">
        <div>
          <p className="font-medium">Pi 对话</p>
          <p className="text-muted-foreground text-xs">当前项目的创作助手</p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="关闭 Pi 对话" onClick={onClose}>
          <X />
        </Button>
      </div>
      <div
        ref={scroller}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4"
        onScroll={() => {
          const element = scroller.current;
          if (element)
            follow.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {loading && (
          <p role="status" className="text-muted-foreground text-sm">
            读取对话中…
          </p>
        )}
        {!loading && messages.length === 0 && (
          <p className="text-muted-foreground text-sm">
            可以讨论创意，或让我创建节点、填写提示词、连接、排列及生成图片和视频。
          </p>
        )}
        {messages.map((message) => (
          <div key={message.id} className="space-y-1">
            <p className="font-medium text-muted-foreground text-xs">
              {message.role === "user" ? "你" : "Pi"}
            </p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
              {message.text}
            </p>
          </div>
        ))}
        {partial && (
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{partial}</p>
        )}
        {busy && (
          <p role="status" className="text-muted-foreground text-xs">
            Pi 正在回复…
          </p>
        )}
      </div>
      {commands.length > 0 && (
        <section className="max-h-52 space-y-2 overflow-auto border-t p-3" aria-label="画布任务">
          {commands.map((command) => (
            <details key={command.id} className="rounded border p-2 text-xs">
              <summary className="cursor-pointer">
                {CANVAS_TOOL_LABELS[command.name]} ·{" "}
                {
                  {
                    pending: "执行中",
                    completed: "已完成",
                    failed: "失败",
                    cancelled: "已停止",
                    unknown: "结果未知",
                  }[command.status]
                }
                {command.status === "pending" && command.progress ? ` · ${command.progress}` : ""}
              </summary>
              <p className="mt-2 whitespace-pre-wrap">
                {command.result?.message ?? (command.result?.success ? "执行完成" : "等待执行回执")}
              </p>
              {Array.isArray(command.result?.data.nodeIds) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const ids = command.result?.data.nodeIds;
                    if (Array.isArray(ids))
                      runtime.focus(ids.filter((id): id is string => typeof id === "string"));
                  }}
                >
                  定位节点
                </Button>
              )}
            </details>
          ))}
        </section>
      )}
      {jobs.length > 0 && (
        <section
          className="max-h-32 space-y-1 overflow-auto border-t p-3 text-xs"
          aria-label="生成任务"
        >
          {jobs.map((job) => (
            <div key={job.id}>
              {job.kind === "image" ? "图片" : "视频"} ·{" "}
              {
                { running: "生成中", succeeded: "成功", failed: "失败", unknown: "结果未知" }[
                  job.status
                ]
              }
              {job.resultUrl && (
                <a className="ml-2 underline" href={job.resultUrl} target="_blank" rel="noreferrer">
                  查看结果
                </a>
              )}
              {job.error && <span className="ml-2 text-destructive">{job.error}</span>}
            </div>
          ))}
        </section>
      )}
      <form onSubmit={send} className="space-y-2 border-t p-3">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <label htmlFor={`pi-message-${projectId}`} className="sr-only">
          发送给 Pi 的消息
        </label>
        <Textarea
          ref={input}
          id={`pi-message-${projectId}`}
          value={draft}
          maxLength={32000}
          placeholder="输入消息…"
          className="max-h-40 resize-none"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground text-xs">Enter 发送 · Shift+Enter 换行</span>
          {busy ? (
            <Button type="button" variant="outline" onClick={stop}>
              <Square />
              停止
            </Button>
          ) : (
            <Button type="submit" disabled={loading || !draft.trim()}>
              发送
            </Button>
          )}
        </div>
      </form>
    </motion.aside>
  );
}
