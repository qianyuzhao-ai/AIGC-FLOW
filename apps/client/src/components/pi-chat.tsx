"use client";

import { Bot, History, SquarePen, X } from "lucide-react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { useContext, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useProjectAgent } from "@/components/agent-workspace";
import { PiChatHistory } from "@/components/pi-chat-history";
import { PiChatInput } from "@/components/pi-chat-input";
import { PiChatMessageRow } from "@/components/pi-chat-message";
import { Button } from "@/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller";
import type { usePiChatResize } from "@/hooks/use-pi-chat-resize";
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
  resize,
}: {
  projectId: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resize: ReturnType<typeof usePiChatResize>;
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
                  resize={resize}
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

function PiChatPanel({
  projectId,
  onClose,
  resize,
}: {
  projectId: number;
  onClose: () => void;
  resize: ReturnType<typeof usePiChatResize>;
}) {
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const runtime = useProjectAgent(projectId);
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot);
  const { messages, loading, error, commands, jobs } = state;
  const busy = state.run?.status === "running";
  const [history, setHistory] = useState(false);
  useEffect(() => {
    if (state.draftImages.length) setHistory(false);
  }, [state.draftImages]);
  useEffect(() => {
    if (isPresent) void runtime.load();
  }, [runtime, isPresent]);
  useEffect(() => {
    const refresh = () => void runtime.refreshSessionInfo();
    window.addEventListener("pi-configuration-changed", refresh);
    return () => window.removeEventListener("pi-configuration-changed", refresh);
  }, [runtime]);
  useEffect(() => {
    const refresh = () => void runtime.refreshSkills();
    window.addEventListener("pi-skills-changed", refresh);
    return () => window.removeEventListener("pi-skills-changed", refresh);
  }, [runtime]);

  return (
    <motion.aside
      ref={resize.panelRef}
      style={{ width: resize.width }}
      id={`pi-chat-panel-${projectId}`}
      aria-label="Pi 对话"
      aria-hidden={!isPresent}
      inert={!isPresent}
      initial={{ x: reducedMotion ? 0 : "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%", transition: piChatTransition(false, reducedMotion) }}
      transition={piChatTransition(true, reducedMotion)}
      className="pointer-events-auto absolute inset-y-0 right-0 flex flex-col border-l bg-background shadow-lg"
    >
      {/* biome-ignore lint/a11y/useSemanticElements: 可拖动和键盘调节的分隔条，不是静态水平线。 */}
      <div
        role="separator"
        aria-label="调整对话宽度"
        aria-orientation="vertical"
        aria-valuemin={resize.bounds.min}
        aria-valuemax={resize.bounds.max}
        aria-valuenow={resize.width}
        aria-controls={`pi-chat-panel-${projectId}`}
        tabIndex={0}
        className="absolute inset-y-0 -left-1 z-10 w-2 touch-none cursor-ew-resize hover:bg-border/60 focus-visible:bg-ring/40 focus-visible:outline-none"
        {...resize.handleProps}
      />
      <div className="flex shrink-0 items-center justify-between gap-2 border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <p className="font-medium text-sm">Pi 对话</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pointer-coarse:min-h-11 pointer-coarse:min-w-11"
            aria-label="新建对话"
            title="新建对话"
            disabled={busy || loading}
            onClick={async () => {
              await runtime.newConversation();
              setHistory(false);
            }}
          >
            <SquarePen />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="历史对话"
            title="历史对话"
            aria-pressed={history}
            onClick={() => {
              setHistory(!history);
              void runtime.refreshConversations();
            }}
          >
            <History />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="关闭 Pi 对话" onClick={onClose}>
            <X />
          </Button>
        </div>
      </div>
      {history && (
        <PiChatHistory
          conversations={state.conversations}
          onRename={(id, title) => runtime.renameConversation(id, title)}
          currentId={state.conversationId}
          disabled={busy || loading}
          onBack={() => setHistory(false)}
          onSelect={async (id) => {
            await runtime.load(id);
            if (runtime.getSnapshot().conversationId === id) setHistory(false);
          }}
        />
      )}
      {history && error && (
        <p role="alert" className="p-3 text-destructive text-xs">
          {error}
        </p>
      )}
      <div className={cn("flex min-h-0 flex-1 flex-col", history && "hidden")}>
        <MessageScrollerProvider
          key={`transcript-${state.conversationId ?? "initial"}`}
          defaultScrollPosition="end"
        >
          <MessageScroller className="min-h-0 flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent
                className="gap-5 p-4"
                aria-busy={busy || loading}
                aria-label="对话记录"
              >
                {loading && messages.length === 0 && (
                  <MessageScrollerItem>
                    <p role="status" className="text-muted-foreground text-sm">
                      读取对话中…
                    </p>
                  </MessageScrollerItem>
                )}
                {!loading && messages.length === 0 && (
                  <MessageScrollerItem>
                    <div className="space-y-2 py-10 text-center">
                      <Bot className="mx-auto size-7 text-muted-foreground" />
                      <p className="font-medium text-sm">从一个想法开始</p>
                      <p className="mx-auto max-w-64 text-muted-foreground text-sm leading-relaxed">
                        讨论创意、操作画布，或选择图片一起分析。对话会自动保存在当前项目。
                      </p>
                    </div>
                  </MessageScrollerItem>
                )}
                {messages.map((message) => {
                  const current = message.role === "assistant" && message.runId === state.run?.id;
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === "user"}
                    >
                      <PiChatMessageRow
                        message={message}
                        jobs={jobs}
                        onFocus={(ids) => runtime.focus(ids)}
                        streaming={current && busy}
                        partial={current ? state.run?.partial : ""}
                        commands={current ? commands : message.commands}
                        error={current ? state.run?.error : message.error}
                      />
                    </MessageScrollerItem>
                  );
                })}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton
              aria-label="回到最新消息"
              behavior={reducedMotion ? "instant" : "smooth"}
              className="motion-reduce:transition-none"
            />
          </MessageScroller>
        </MessageScrollerProvider>
        <PiChatInput
          key={`composer-${state.conversationId ?? "initial"}`}
          runtime={runtime}
          busy={busy}
          loading={loading}
          error={error}
          images={state.draftImages}
          sessionInfo={state.sessionInfo}
          thinkingLevel={state.thinkingLevel}
          skills={state.skills}
        />
      </div>
    </motion.aside>
  );
}
