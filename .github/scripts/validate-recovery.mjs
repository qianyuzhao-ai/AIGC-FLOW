import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateRecovery(run, jobs, repository, tag, commit) {
  assert.equal(run.repository?.full_name, repository, "构建必须来自当前仓库");
  assert.equal(run.path, ".github/workflows/release.yml", "只恢复正式 Release 工作流的产物");
  assert.equal(run.event, "push", "原构建必须由标签 push 触发");
  assert.equal(run.status, "completed", "原工作流尚未结束");
  assert.equal(run.head_branch, tag, "原构建标签不一致");
  assert.equal(run.head_sha, commit, "标签提交与原构建不一致，禁止恢复");
  for (const name of ["打包 macOS", "打包 Windows"]) {
    const matches = jobs.filter((job) => job.name === name);
    assert.equal(matches.length, 1, `缺少或重复打包任务：${name}`);
    assert.equal(matches[0].conclusion, "success", `原打包任务未成功：${name}`);
  }
}

function main() {
  const { GITHUB_REPOSITORY: repository, TAG: tag, SOURCE_RUN_ID: runId } = process.env;
  assert.match(runId ?? "", /^\d+$/, "构建 run ID 必须为数字");
  assert.match(
    tag ?? "",
    /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/,
    "版本标签无效",
  );
  const gh = (...args) => execFileSync("gh", args, { encoding: "utf8" }).trim();
  const endpoint = `repos/${repository}/actions/runs/${runId}`;
  const run = JSON.parse(gh("api", endpoint));
  const { jobs } = JSON.parse(gh("api", `${endpoint}/jobs?filter=latest&per_page=100`));
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  validateRecovery(run, jobs, repository, tag, commit);
  const remoteCommit = gh("api", `repos/${repository}/commits/${tag}`, "--jq", ".sha");
  assert.equal(remoteCommit, commit, "远端标签已移动，禁止恢复");
  console.log(`已确认构建 ${runId} 的两个平台均成功，提交 ${commit}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main();
}
