"use client";

import type { PiChatMessage } from "@aigc-flow/shared";
import { Bot, Square, X } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { type FormEvent, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { apiError } from "@/lib/api-error";
import { CanvasPortalContext } from "@/lib/desktop";
import { readPiStream } from "@/lib/pi-stream";
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
  const [messages, setMessages] = useState<PiChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const route = api.api.pi.projects[":projectId"];
  const param = { projectId: String(projectId) };

  useEffect(() => {
    if (!isPresent) return;
    setLoading(true);
    setBusy(false);
    setPartial("");
    setError("");
    const controller = new AbortController();
    request.current = controller;
    api.api.pi.projects[":projectId"].messages
      .$get({ param: { projectId: String(projectId) } }, { init: { signal: controller.signal } })
      .then(async (res) => {
        if (!res.ok) throw await apiError(res);
        const value = await res.json();
        if (!controller.signal.aborted) {
          setMessages(value.messages);
          setBusy(value.running);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "读取对话失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    input.current?.focus({ preventScroll: true });
    return () => request.current?.abort();
  }, [projectId, isPresent]);

  useEffect(() => {
    if ((messages.length > 0 || partial) && follow.current && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages, partial]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (busy || loading || !draft.trim()) return;
    const message = draft.trim();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setPartial("");
    follow.current = true;
    try {
      const response = await route.messages.$post(
        { param, json: { message } },
        { init: { signal: controller.signal } },
      );
      if (!response.ok) throw await apiError(response);
      setDraft("");
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text: message },
      ]);
      for await (const update of readPiStream(response)) {
        if (update.type === "text") setPartial((current) => current + update.delta);
        if (update.type === "error") setError(update.message);
        if (update.type === "done") {
          setMessages(update.messages);
          setPartial("");
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "对话失败");
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        input.current?.focus();
      }
    }
  }

  async function stop() {
    try {
      const response = await route.abort.$post({ param });
      if (!response.ok) throw await apiError(response);
      const history = await route.messages.$get({ param });
      if (!history.ok) throw await apiError(history);
      const value = await history.json();
      setMessages(value.messages);
      setPartial("");
      setBusy(value.running);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "停止失败");
    }
  }

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
            可以讨论创作方案、整理提示词。当前尚未连接画布操作工具。
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
