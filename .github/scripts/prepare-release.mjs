import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseState } from "./release-state.mjs";

const packageFiles = [
  "package.json",
  "apps/client/package.json",
  "apps/server/package.json",
  "apps/desktop/package.json",
  "packages/shared/package.json",
];

export function prepareRelease(cwd, env) {
  assert.equal(env.GITHUB_EVENT_NAME, "push", "只接受版本标签 push 事件");
  assert.equal(env.GITHUB_REF_TYPE, "tag", "只接受版本标签");
  const tag = env.GITHUB_REF_NAME;
  assert.match(
    tag,
    /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
    "标签应为 vX.Y.Z 或 vX.Y.Z-beta.1",
  );
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD");
  assert.equal(commit, git("rev-parse", `${env.GITHUB_SHA}^{commit}`), "构建提交与触发提交不一致");
  assert.equal(commit, git("rev-parse", `refs/tags/${tag}^{commit}`), "标签已移动，请使用新版本号");
  try {
    git("merge-base", "--is-ancestor", commit, "refs/remotes/origin/main");
  } catch {
    throw new Error("标签提交尚未合并到 main，禁止打包发布");
  }
  const version = tag.slice(1);
  for (const file of packageFiles) {
    const metadata = JSON.parse(readFileSync(resolve(cwd, file), "utf8"));
    assert.equal(metadata.version, version, `${file} 的版本必须与 ${tag} 一致`);
  }
  const changelog = readFileSync(resolve(cwd, "CHANGELOG.md"), "utf8").replaceAll("\r\n", "\n");
  const section = changelog.split(`\n## ${version}\n`)[1]?.split("\n## ")[0]?.trim();
  assert.ok(section, `CHANGELOG.md 缺少 ${version} 的更新说明`);
  return { tag, version, commit, prerelease: version.includes("-"), notes: section };
}

async function main() {
  const release = prepareRelease(process.cwd(), process.env);
  const state = await releaseState(
    process.env.GITHUB_REPOSITORY,
    release.tag,
    process.env.GH_TOKEN,
  );
  assert.notEqual(state, "published", "该版本已发布；修复请递增版本，不覆盖已发布安装包");
  const outputs = { ...release, state };
  delete outputs.notes;
  for (const [name, value] of Object.entries(outputs)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
  const run = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  writeFileSync(
    "RELEASE_NOTES.md",
    `${release.notes}\n\n构建提交：\`${release.commit}\`\n\n[构建记录](${run})\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
