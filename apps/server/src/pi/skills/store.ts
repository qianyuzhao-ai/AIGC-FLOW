import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { type PiSkill, piSkillNameSchema, piSkillSchema } from "@aigc-flow/shared";
import { z } from "zod";
import { agentDir } from "../runtime";
import { type ArchiveSkill, MAX_SKILL_FILE_BYTES, skillRelativePath } from "./archive";

export const skillsRoot = join(agentDir, "skills");
const registryPath = join(agentDir, "skill-registry.json");
const registrySchema = z.object({ version: z.literal(1), skills: z.array(piSkillSchema).max(64) });
export function skillRegistry() {
  let content: string;
  try {
    content = readFileSync(registryPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return { skills: [] as PiSkill[], revision: "empty" };
    throw error;
  }
  const registry = registrySchema.parse(JSON.parse(content));
  return { skills: registry.skills, revision: createHash("sha256").update(content).digest("hex") };
}

let writing: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>) {
  const result = writing.then(operation);
  writing = result.catch(() => {});
  return result;
}
async function saveRegistry(skills: PiSkill[]) {
  const temporary = `${registryPath}.${randomUUID()}.tmp`;
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify({ version: 1, skills }, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, registryPath);
}

export function installSkill(skill: ArchiveSkill, source: string) {
  return serialize(async () => {
    const { skills } = skillRegistry();
    if (skills.length >= 64) throw new Error("最多安装 64 个技能");
    if (skills.filter((item) => item.enabled).length >= 32)
      throw new Error("最多启用 32 个技能，请先停用部分技能");
    const target = join(skillsRoot, piSkillNameSchema.parse(skill.name));
    if (skills.some((item) => item.name === skill.name) || existsSync(target))
      throw new Error(`已存在同名技能 ${skill.name}，没有覆盖现有文件`);
    const staging = join(agentDir, "skill-staging", randomUUID());
    await mkdir(staging, { recursive: true, mode: 0o700 });
    for (const [path, bytes] of skill.files) {
      const file = join(staging, skillRelativePath(path));
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, bytes, { flag: "wx", mode: 0o600 });
    }
    await mkdir(skillsRoot, { recursive: true, mode: 0o700 });
    if (lstatSync(skillsRoot).isSymbolicLink()) throw new Error("应用技能目录不能使用符号链接");
    await rename(staging, target);
    const installed: PiSkill = {
      name: skill.name,
      description: skill.description,
      enabled: true,
      source,
      installedAt: new Date().toISOString(),
      digest: skill.digest,
      files: [...skill.files].map(([path, bytes]) => ({ path, size: bytes.length })),
    };
    await saveRegistry([...skills, installed]);
    return installed;
  });
}

export function setSkillEnabled(name: string, enabled: boolean) {
  return serialize(async () => {
    const { skills } = skillRegistry();
    const skill = skills.find((item) => item.name === name);
    if (!skill) throw new Error("技能不存在");
    if (enabled && !skill.enabled && skills.filter((item) => item.enabled).length >= 32)
      throw new Error("最多启用 32 个技能");
    await saveRegistry(skills.map((item) => (item.name === name ? { ...item, enabled } : item)));
    return { ...skill, enabled };
  });
}

export function installedSkillFile(name: string, file: string) {
  const skill = skillRegistry().skills.find((item) => item.name === name && item.enabled);
  if (!skill) throw new Error("技能不存在或已停用");
  const path = skillRelativePath(file);
  if (!skill.files.some((item) => item.path === path))
    throw new Error("文件不在此技能的安装清单中");
  const root = join(skillsRoot, piSkillNameSchema.parse(name));
  if (lstatSync(skillsRoot).isSymbolicLink()) throw new Error("应用技能目录不能使用符号链接");
  let current = root;
  for (const part of ["", ...path.split("/")]) {
    current = part ? join(current, part) : current;
    if (lstatSync(current).isSymbolicLink()) throw new Error("技能文件不能使用符号链接");
  }
  const actual = realpathSync(current);
  const local = relative(realpathSync(skillsRoot), actual);
  if (!local.startsWith(`${name}${sep}`) || lstatSync(actual).size > MAX_SKILL_FILE_BYTES)
    throw new Error("技能文件路径或大小不符合限制");
  return actual;
}

export function readSkillText(name: string, file = "SKILL.md") {
  const bytes = readFileSync(installedSkillFile(name, file));
  if (bytes.length > MAX_SKILL_FILE_BYTES || bytes.includes(0))
    throw new Error("仅支持读取技能内的 UTF-8 文本资料");
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
