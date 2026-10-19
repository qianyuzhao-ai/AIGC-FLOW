import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { PiSkillPreview } from "@aigc-flow/shared";
import { type ArchiveSkill, inspectSkillArchive } from "./archive";
import { installSkill, skillRegistry, skillsRoot } from "./store";

type Preview = { source: string; skills: ArchiveSkill[]; issues: string[]; expires: number };
const previews = new Map<string, Preview>();
export async function previewSkills(
  bytes: Buffer,
  source: string,
  directory = "",
): Promise<PiSkillPreview> {
  const result = await inspectSkillArchive(bytes, directory);
  for (const [id, preview] of previews) if (preview.expires < Date.now()) previews.delete(id);
  const id = randomUUID();
  const preview = { ...result, source, expires: Date.now() + 15 * 60_000 };
  previews.set(id, preview);
  if (previews.size > 3) {
    const oldest = previews.keys().next().value;
    if (oldest) previews.delete(oldest);
  }
  const installed = skillRegistry().skills;
  return {
    id,
    source,
    expiresAt: new Date(preview.expires).toISOString(),
    issues: result.issues,
    skills: result.skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      content: skill.content,
      warnings: skill.warnings,
      destination: join(skillsRoot, skill.name),
      installed: installed.some((item) => item.name === skill.name),
      files: [...skill.files].map(([path, bytes]) => ({ path, size: bytes.length })),
    })),
  };
}

export function installPreviewSkill(previewId: string, skillId: string) {
  const preview = previews.get(previewId);
  if (!preview || preview.expires < Date.now())
    throw new Error("预览已过期或服务已重启，请重新选择来源并预览");
  const skill = preview.skills.find((item) => item.id === skillId);
  if (!skill) throw new Error("技能不在这次预览中");
  return installSkill(skill, preview.source);
}
