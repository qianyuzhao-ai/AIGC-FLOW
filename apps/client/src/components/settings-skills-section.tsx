"use client";

import {
  MAX_SKILL_ARCHIVE_BYTES,
  type PiSkill,
  type PiSkillPreview,
  piSkillPreviewSchema,
} from "@aigc-flow/shared";
import { FileUp, LoaderCircle } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { PiSkillPreviewPanel } from "@/components/pi-skill-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { apiError } from "@/lib/api-error";

export function SettingsSkillsSection() {
  const [skills, setSkills] = useState<PiSkill[]>([]);
  const [directory, setDirectory] = useState("");
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<PiSkillPreview | null>(null);
  const [busy, setBusy] = useState<string | null>("load");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    api.api.pi.skills
      .$get({}, { init: { signal: controller.signal } })
      .then(async (response) => {
        if (!response.ok) throw await apiError(response);
        const value = await response.json();
        if (!controller.signal.aborted) {
          setSkills(value.skills);
          setDirectory(value.directory);
        }
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "读取技能失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(null);
      });
    return () => request.current?.abort();
  }, []);

  async function operation(kind: string, run: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(kind);
    setError("");
    setNotice("");
    try {
      await run(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : "技能操作失败");
    } finally {
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  async function upload(file: File) {
    await operation("preview", async (signal) => {
      setPreview(null);
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) throw new Error("技能包最多 20 MB");
      const form = new FormData();
      form.set("file", file);
      const response = await api.api.pi.skills.preview.$post({}, { init: { body: form, signal } });
      if (!response.ok) throw await apiError(response);
      setPreview(piSkillPreviewSchema.parse(await response.json()));
    });
  }
  async function github(event: FormEvent) {
    event.preventDefault();
    await operation("preview", async (signal) => {
      setPreview(null);
      const response = await api.api.pi.skills.github.preview.$post(
        { json: { url: url.trim() } },
        { init: { signal } },
      );
      if (!response.ok) throw await apiError(response);
      setPreview(piSkillPreviewSchema.parse(await response.json()));
    });
  }
  async function install(skillId: string) {
    if (!preview) return;
    await operation("install", async (signal) => {
      const response = await api.api.pi.skills.install.$post(
        { json: { previewId: preview.id, skillId } },
        { init: { signal } },
      );
      if (!response.ok) throw await apiError(response);
      const installed = await response.json();
      setSkills((current) => [...current, installed]);
      setNotice(`${installed.name} 已安装，下一轮对话即可使用。`);
      window.dispatchEvent(new Event("pi-skills-changed"));
    });
  }
  async function toggle(skill: PiSkill) {
    await operation(skill.name, async (signal) => {
      const response = await api.api.pi.skills[":name"].$patch(
        { param: { name: skill.name }, json: { enabled: !skill.enabled } },
        { init: { signal } },
      );
      if (!response.ok) throw await apiError(response);
      const updated = await response.json();
      setSkills((current) => current.map((item) => (item.name === updated.name ? updated : item)));
      window.dispatchEvent(new Event("pi-skills-changed"));
    });
  }
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        为创作助手安装技能说明和参考资料。已启用技能对所有项目生效，仅使用现有画布工具，不执行脚本。
      </p>
      <div className="space-y-2">
        <Button
          type="button"
          variant="outline"
          disabled={Boolean(busy)}
          onClick={() => picker.current?.click()}
        >
          <FileUp />
          选择技能包并预览
        </Button>
        <input
          ref={picker}
          type="file"
          accept=".skill,.zip"
          className="hidden"
          aria-label="选择技能包"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (file) void upload(file);
          }}
        />
        <p className="text-muted-foreground text-xs">
          支持 .skill / ZIP，最多 20 MB，包内需要包含 SKILL.md。
        </p>
      </div>
      <form onSubmit={github} className="space-y-2">
        <label htmlFor="pi-skill-github" className="font-medium text-sm">
          GitHub 地址
        </label>
        <div className="flex gap-2">
          <Input
            id="pi-skill-github"
            type="url"
            placeholder="https://github.com/owner/repo/tree/main/skills/example"
            value={url}
            disabled={Boolean(busy)}
            onChange={(event) => setUrl(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={Boolean(busy) || !url.trim()}>
            预览
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">支持公开仓库和技能目录地址。</p>
      </form>
      {busy && (
        <p role="status" className="flex items-center gap-2 text-muted-foreground text-sm">
          <LoaderCircle className="size-4 motion-safe:animate-spin" />
          {busy === "preview"
            ? "正在读取技能包…"
            : busy === "install"
              ? "正在安装…"
              : "正在读取或更新技能…"}
        </p>
      )}
      {error && (
        <p role="alert" className="whitespace-pre-wrap break-words text-destructive text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {preview && (
        <PiSkillPreviewPanel
          preview={preview}
          installedNames={new Set(skills.map((skill) => skill.name))}
          busy={Boolean(busy)}
          onInstall={(id) => void install(id)}
          onClose={() => setPreview(null)}
        />
      )}
      <section className="space-y-3 border-t pt-4" aria-label="已安装技能">
        <h3 className="font-medium">已安装技能 · {skills.length}</h3>
        {skills.map((skill) => (
          <article key={skill.name} className="space-y-1 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-sm">
                {skill.name}
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {skill.enabled ? "已启用" : "已停用"}
                </span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={Boolean(busy)}
                aria-label={`${skill.enabled ? "停用" : "启用"} ${skill.name}`}
                onClick={() => void toggle(skill)}
              >
                {skill.enabled ? "停用" : "启用"}
              </Button>
            </div>
            <p className="text-muted-foreground text-sm">{skill.description}</p>
            <code className="block select-all text-xs">/skill:{skill.name} 你的需求</code>
            <details>
              <summary className="cursor-pointer text-muted-foreground text-xs">安装信息</summary>
              <p className="mt-1 break-all text-xs">{skill.source}</p>
              <p className="text-muted-foreground text-xs">
                {skill.files.length} 个文件 · {new Date(skill.installedAt).toLocaleString()}
              </p>
            </details>
          </article>
        ))}
        {!skills.length && !busy && (
          <p className="text-muted-foreground text-sm">
            尚未安装技能，从本地技能包或 GitHub 添加。
          </p>
        )}
        {directory && (
          <p className="break-all text-muted-foreground text-xs">应用技能目录：{directory}</p>
        )}
      </section>
    </div>
  );
}
