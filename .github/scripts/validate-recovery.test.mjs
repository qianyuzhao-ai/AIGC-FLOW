import assert from "node:assert/strict";
import test from "node:test";
import { validateRecovery } from "./validate-recovery.mjs";

const repository = "test/repo";
const tag = "v1.2.3";
const commit = "original-build-sha";
const run = {
  repository: { full_name: repository },
  path: ".github/workflows/release.yml",
  event: "push",
  status: "completed",
  head_branch: tag,
  head_sha: commit,
  conclusion: "failure",
};
const jobs = [
  { name: "打包 macOS", conclusion: "success" },
  { name: "打包 Windows", conclusion: "success" },
  { name: "发布本轮安装包", conclusion: "failure" },
];

test("recovers successful builds even when their publication failed", () => {
  assert.doesNotThrow(() => validateRecovery(run, jobs, repository, tag, commit));
});

test("rejects another repository, workflow, event, tag, commit or unfinished run", () => {
  for (const change of [
    { repository: { full_name: "other/repo" } },
    { path: ".github/workflows/other.yml" },
    { event: "workflow_dispatch" },
    { status: "in_progress" },
    { head_branch: "v1.2.4" },
    { head_sha: "different-sha" },
  ]) {
    assert.throws(() => validateRecovery({ ...run, ...change }, jobs, repository, tag, commit));
  }
});

test("requires exactly one successful build for each platform", () => {
  for (const invalid of [
    jobs.filter((job) => job.name !== "打包 Windows"),
    [...jobs, jobs[0]],
    jobs.map((job) => (job.name === "打包 Windows" ? { ...job, conclusion: "failure" } : job)),
  ]) {
    assert.throws(() => validateRecovery(run, invalid, repository, tag, commit));
  }
});
