import { MAX_SKILL_ARCHIVE_BYTES } from "@aigc-flow/shared";
import { z } from "zod";

export function parseSkillGithubUrl(input: string) {
  const url = new URL(input);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("请输入公开 github.com 仓库或技能目录的 HTTPS 地址");
  const parts = url.pathname.replace(/\/+$/, "").split("/").slice(1).map(decodeURIComponent);
  const [owner, rawRepo, mode, ref, ...path] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (
    !owner ||
    !repo ||
    !/^[\w.-]+$/.test(owner) ||
    !/^[\w.-]+$/.test(repo) ||
    [owner, repo].some((part) => part === "." || part === "..")
  )
    throw new Error("GitHub 仓库地址无效");
  if (mode && (!["tree", "blob"].includes(mode) || !ref))
    throw new Error("支持仓库地址及 tree/blob 目录地址");
  if (mode === "blob" && path.at(-1) !== "SKILL.md") throw new Error("文件地址必须指向 SKILL.md");
  const directory = (mode === "blob" ? path.slice(0, -1) : path).join("/");
  return { owner, repo, ref: ref ?? "HEAD", directory };
}

export async function boundedResponse(response: Response, limit: number) {
  if (!response.ok) {
    if (response.status === 403 || response.status === 429)
      throw new Error("GitHub 请求受限，请稍后重试或上传本地技能包");
    if (response.status === 404)
      throw new Error("仓库或分支不存在，或不是公开仓库；可改用本地技能包");
    throw new Error(`技能下载失败（${response.status}）`);
  }
  if (!response.body) throw new Error("技能下载内容为空");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        throw new Error("内容过大，请上传单个技能包（最多 20 MB）");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

export async function downloadGithubSkills(input: string, signal?: AbortSignal) {
  const source = parseSkillGithubUrl(input);
  const timeout = AbortSignal.timeout(45_000);
  const options = {
    redirect: "error" as const,
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  };
  const commitResponse = await fetch(
    `https://api.github.com/repos/${source.owner}/${source.repo}/commits/${encodeURIComponent(source.ref)}`,
    {
      ...options,
      headers: { Accept: "application/vnd.github+json", "User-Agent": "AIGC-FLOW" },
    },
  );
  const { sha } = z
    .object({ sha: z.string().regex(/^[a-f0-9]{40}$/) })
    .parse(JSON.parse((await boundedResponse(commitResponse, 2 * 1024 * 1024)).toString("utf8")));
  const archive = await fetch(
    `https://codeload.github.com/${source.owner}/${source.repo}/zip/${sha}`,
    options,
  );
  return {
    bytes: await boundedResponse(archive, MAX_SKILL_ARCHIVE_BYTES),
    directory: source.directory,
    source: `https://github.com/${source.owner}/${source.repo}/tree/${sha}${source.directory ? `/${source.directory}` : ""}`,
  };
}
