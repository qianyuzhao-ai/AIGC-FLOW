"use client";

import type { PiConversation } from "@aigc-flow/shared";
import { ArrowLeft, Check, MessageSquare } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PiChatHistory({
  conversations,
  currentId,
  disabled,
  onSelect,
  onBack,
}: {
  conversations: PiConversation[];
  currentId: string | null;
  disabled: boolean;
  onSelect: (id: string) => Promise<void>;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const matching = conversations.filter((item) =>
    item.title.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section aria-label="历史对话列表" className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="返回对话" onClick={onBack}>
          <ArrowLeft />
        </Button>
        <h2 className="font-medium text-sm">历史对话</h2>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {conversations.length} 段
        </span>
      </div>
      <Input
        type="search"
        aria-label="搜索历史对话"
        placeholder="搜索对话…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {matching.map((item) => (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            aria-current={item.id === currentId ? "true" : undefined}
            className="flex w-full items-start gap-3 rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 aria-current:bg-muted [content-visibility:auto] [contain-intrinsic-size:auto_4rem]"
            onClick={() => void onSelect(item.id)}
          >
            <MessageSquare className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{item.title}</span>
              <time dateTime={item.updatedAt} className="mt-1 block text-muted-foreground text-xs">
                {new Date(item.updatedAt).toLocaleString("zh-CN", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </span>
            {item.id === currentId && <Check className="size-4 shrink-0" />}
          </button>
        ))}
        {matching.length === 0 && (
          <p className="py-8 text-center text-muted-foreground text-sm">没有找到对话</p>
        )}
      </div>
    </section>
  );
}
