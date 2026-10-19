"use client";

import { type PiConversation, renamePiConversationSchema } from "@aigc-flow/shared";
import { type FormEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function PiChatRenameDialog({
  conversation,
  onRename,
  onClose,
}: {
  conversation: PiConversation;
  onRename: (id: string, title: string) => Promise<void>;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(conversation.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const parsed = renamePiConversationSchema.safeParse({ title });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查对话名称");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onRename(conversation.id, parsed.data.title);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          input.current?.focus();
          input.current?.select();
        }}
      >
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle>重命名对话</DialogTitle>
            <DialogDescription>修改名称，保留对话内容。</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <label htmlFor="pi-conversation-title" className="font-medium text-sm">
              对话名称
            </label>
            <Input
              ref={input}
              id="pi-conversation-title"
              value={title}
              maxLength={100}
              disabled={saving}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "pi-rename-error" : undefined}
              onChange={(event) => {
                setTitle(event.target.value);
                setError("");
              }}
            />
            {error && (
              <p id="pi-rename-error" role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              取消
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
