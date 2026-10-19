"use client";

import type { PiSkillPreview } from "@aigc-flow/shared";
import { Button } from "@/components/ui/button";

export function PiSkillPreviewPanel({
  preview,
  installedNames,
  busy,
  onInstall,
  onClose,
}: {
  preview: PiSkillPreview;
  installedNames: Set<string>;
  busy: boolean;
  onInstall: (skillId: string) => void;
  onClose: () => void;
}) {
  return (
    <section className="space-y-3 rounded-lg border p-3" aria-label="技能安装预览">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-medium">安装预览</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
          关闭预览
        </Button>
      </div>
      <p className="break-all text-muted-foreground text-xs">来源：{preview.source}</p>
      {preview.issues.map((issue) => (
        <p key={issue} className="whitespace-pre-wrap text-destructive text-xs">
          {issue}
        </p>
      ))}
      {preview.skills.map((skill) => {
        const installed = installedNames.has(skill.name) || skill.installed;
        return (
          <article key={skill.id} className="space-y-2 border-t pt-3">
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-medium">{skill.name}</h4>
              <Button
                type="button"
                size="sm"
                disabled={busy || installed}
                onClick={() => onInstall(skill.id)}
              >
                {installed ? "已安装" : "确认安装"}
              </Button>
            </div>
            <p className="text-sm">{skill.description}</p>
            <p className="break-all text-muted-foreground text-xs">安装位置：{skill.destination}</p>
            {skill.warnings.map((warning) => (
              <p key={warning} className="text-muted-foreground text-xs">
                {warning}
              </p>
            ))}
            <details open>
              <summary className="cursor-pointer text-sm">SKILL.md</summary>
              <pre className="mt-2 max-h-52 overflow-auto rounded-md bg-muted p-3 whitespace-pre-wrap break-words text-xs">
                {skill.content}
              </pre>
            </details>
            <details>
              <summary className="cursor-pointer text-muted-foreground text-xs">
                包内文件 · {skill.files.length}
              </summary>
              <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs">
                {skill.files.map((file) => (
                  <li key={file.path} className="flex justify-between gap-3">
                    <span className="break-all">{file.path}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {Math.ceil(file.size / 1024)} KB
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          </article>
        );
      })}
      {!preview.skills.length && (
        <p className="text-muted-foreground text-sm">没有可安装的技能，请检查上面的格式问题。</p>
      )}
    </section>
  );
}
