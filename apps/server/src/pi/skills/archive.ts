import { createHash } from "node:crypto";
import { posix } from "node:path";
import { MAX_SKILL_ARCHIVE_BYTES, piSkillNameSchema } from "@aigc-flow/shared";
import { parse } from "yaml";
import { type Entry, fromBufferPromise, type ZipFile } from "yauzl";
import { z } from "zod";

export const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
const frontmatter = z.object({
  name: piSkillNameSchema,
  description: z.string().trim().min(1).max(1024),
  "disable-model-invocation": z.boolean().optional(),
});
export type ArchiveSkill = {
  id: string;
  name: string;
  description: string;
  content: string;
  files: Map<string, Buffer>;
  warnings: string[];
  digest: string;
};

export function skillRelativePath(path: string) {
  const normalized = path.normalize("NFC");
  if (
    !normalized ||
    normalized.length > 500 ||
    normalized.includes("\\") ||
    normalized.startsWith("/")
  )
    throw new Error("技能包含无效路径");
  for (const part of normalized.split("/")) {
    if (
      !part ||
      part === "." ||
      part === ".." ||
      /\p{Cc}/u.test(part) ||
      /[<>:"|?*]/.test(part) ||
      /[. ]$/.test(part) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)
    )
      throw new Error(`技能包含不支持的路径：${path}`);
  }
  return normalized;
}

async function entryBytes(zip: ZipFile, entry: Entry) {
  if (entry.uncompressedSize > MAX_SKILL_FILE_BYTES)
    throw new Error(`单个文件超过 2 MB：${entry.fileName}`);
  const stream = await zip.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_SKILL_FILE_BYTES) throw new Error(`文件解压后超过 2 MB：${entry.fileName}`);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

export async function inspectSkillArchive(bytes: Buffer, directory = "") {
  if (bytes.length > MAX_SKILL_ARCHIVE_BYTES) throw new Error("技能包最多 20 MB");
  const zip = await fromBufferPromise(bytes, { strictFileNames: true, validateEntrySizes: true });
  try {
    if (zip.entryCount > 5000) throw new Error("包内文件过多，请提供单个技能目录或技能包");
    const entries = new Map<string, Entry>();
    const seen = new Set<string>();
    for await (const entry of zip.eachEntry()) {
      const raw = entry.fileName.replace(/\/$/, "");
      if (
        raw
          .split("/")
          .some((part) => ["__MACOSX", ".DS_Store", ".git", "node_modules"].includes(part))
      )
        continue;
      const path = skillRelativePath(raw);
      if (entry.fileName.endsWith("/")) continue;
      if (seen.has(path.toLowerCase())) throw new Error(`包内路径重复或仅大小写不同：${path}`);
      seen.add(path.toLowerCase());
      entries.set(path, entry);
    }
    let prefix = "";
    if (directory) {
      const root = [...entries.keys()][0]?.split("/")[0];
      prefix = `${root}/${skillRelativePath(directory).replace(/\/SKILL\.md$/, "")}/`;
    }
    const manifests = [...entries.keys()].filter(
      (path) => path.startsWith(prefix) && posix.basename(path) === "SKILL.md",
    );
    if (manifests.length > 256) throw new Error("技能清单过多，请提供具体技能目录");
    const roots = manifests.filter(
      (path) =>
        !manifests.some(
          (parent) =>
            parent !== path &&
            path.startsWith(posix.dirname(parent) === "." ? "" : `${posix.dirname(parent)}/`),
        ),
    );
    if (!roots.length) throw new Error("没有找到 SKILL.md，请选择包含技能的目录或 ZIP 包");
    if (roots.length > 32) throw new Error("包内技能超过 32 个，请提供具体技能目录");
    const skills: ArchiveSkill[] = [];
    const issues: string[] = [];
    let total = 0;
    for (const manifest of roots) {
      const base = posix.dirname(manifest) === "." ? "" : `${posix.dirname(manifest)}/`;
      const files = new Map<string, Buffer>();
      try {
        const selected = [...entries].filter(([path]) => path.startsWith(base));
        if (selected.length > 256) throw new Error("单个技能最多 256 个文件");
        for (const [path, entry] of selected) {
          const kind = (entry.externalFileAttributes >>> 16) & 0o170000;
          if ((kind && kind !== 0o100000) || entry.isEncrypted())
            throw new Error(`不支持链接、特殊文件或加密文件：${path}`);
          total += entry.uncompressedSize;
          if (total > MAX_SKILL_ARCHIVE_BYTES) throw new Error("技能文件解压后合计超过 20 MB");
          const relative = path.slice(base.length);
          files.set(relative, await entryBytes(zip, entry));
        }
        for (const path of files.keys()) {
          let parent = posix.dirname(path);
          while (parent !== ".") {
            if (files.has(parent)) throw new Error(`文件与目录路径冲突：${parent}`);
            parent = posix.dirname(parent);
          }
        }
        const content = new TextDecoder("utf-8", { fatal: true }).decode(files.get("SKILL.md"));
        if (Buffer.byteLength(content) > 64 * 1024) throw new Error("SKILL.md 最多 64 KB");
        const normalizedContent = content.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
        const match = normalizedContent.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
        if (!match) throw new Error("SKILL.md 必须包含 YAML frontmatter");
        const metadata = frontmatter.parse(
          parse(match[1] ?? "", { uniqueKeys: true, maxAliasCount: 0 }),
        );
        skillRelativePath(metadata.name);
        if (!normalizedContent.slice(match[0].length).trim())
          throw new Error("SKILL.md 缺少技能说明正文");
        const hash = createHash("sha256");
        for (const [path, data] of [...files].sort(([a], [b]) => a.localeCompare(b)))
          hash.update(path).update("\0").update(data);
        const warnings: string[] = [];
        if (
          [...files.keys()].some(
            (path) =>
              path.startsWith("scripts/") || /\.(sh|py|js|ts|mjs|cjs|ps1|bat|cmd)$/i.test(path),
          )
        )
          warnings.push("包含脚本文件，仅保存与读取，不会执行。");
        if (metadata["disable-model-invocation"])
          warnings.push("此技能仅通过 /skill:名称 显式调用。");
        skills.push({
          id: manifest,
          name: metadata.name,
          description: metadata.description,
          content,
          files,
          warnings,
          digest: hash.digest("hex"),
        });
      } catch (error) {
        issues.push(`${manifest}：${error instanceof Error ? error.message : "技能包无效"}`);
      }
    }
    const duplicates = skills
      .filter((skill, i) => skills.findIndex((other) => other.name === skill.name) !== i)
      .map((skill) => skill.name);
    if (duplicates.length) throw new Error(`包内技能名称重复：${duplicates.join("、")}`);
    return { skills, issues };
  } finally {
    zip.close();
  }
}
