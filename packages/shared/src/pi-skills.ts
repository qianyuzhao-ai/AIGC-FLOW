import { z } from "zod";

export const MAX_SKILL_ARCHIVE_BYTES = 20 * 1024 * 1024;
export const piSkillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "技能名称只能包含小写字母、数字和单个连字符");
export const piSkillFileSchema = z.object({
  path: z.string(),
  size: z.number().int().nonnegative(),
});
export const piSkillSchema = z.object({
  name: piSkillNameSchema,
  description: z.string().min(1).max(1024),
  enabled: z.boolean(),
  source: z.string(),
  installedAt: z.string(),
  digest: z.string(),
  files: z.array(piSkillFileSchema),
});
export type PiSkill = z.infer<typeof piSkillSchema>;
export const piSkillCandidateSchema = z.object({
  id: z.string(),
  name: piSkillNameSchema,
  description: z.string(),
  content: z.string(),
  files: z.array(piSkillFileSchema),
  warnings: z.array(z.string()),
  installed: z.boolean(),
  destination: z.string(),
});
export const piSkillPreviewSchema = z.object({
  id: z.string(),
  source: z.string(),
  expiresAt: z.string(),
  skills: z.array(piSkillCandidateSchema),
  issues: z.array(z.string()),
});
export type PiSkillPreview = z.infer<typeof piSkillPreviewSchema>;
export const piSkillGithubSchema = z.object({ url: z.url().max(2000) });
export const piSkillInstallSchema = z.object({
  previewId: z.string().uuid(),
  skillId: z.string().min(1).max(1000),
});
export const piSkillEnabledSchema = z.object({ enabled: z.boolean() });
