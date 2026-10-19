import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { prepareRelease } from "./prepare-release.mjs";
import { releaseState } from "./release-state.mjs";

function fixture(version = "1.2.3") {
  const cwd = mkdtempSync(join(tmpdir(), "aigc-release-"));
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
  const write = (file, content) => {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
  };
  for (const directory of [".", "apps/client", "apps/server", "apps/desktop", "packages/shared"]) {
    write(`${directory}/package.json`, JSON.stringify({ version }));
  }
  write("CHANGELOG.md", `# 更新记录\n\n## ${version}\n\n本次更新。\n\n## 1.0.0\n旧内容。\n`);
  git("init", "-b", "main");
  git("config", "user.email", "release-test@example.com");
  git("config", "user.name", "Release test");
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
  git("add", ".");
  git("commit", "-m", "release fixture");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("tag", "-a", `v${version}`, "-m", `v${version}`);
  const env = {
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF_TYPE: "tag",
    GITHUB_REF_NAME: `v${version}`,
    GITHUB_SHA: git("rev-parse", "HEAD"),
  };
  return { cwd, env, git, write };
}

test("accepts a main tag and extracts only its release notes", () => {
  const { cwd, env } = fixture();
  assert.deepEqual(prepareRelease(cwd, env), {
    tag: "v1.2.3",
    version: "1.2.3",
    commit: env.GITHUB_SHA,
    prerelease: false,
    notes: "本次更新。",
  });
});

test("accepts annotated prerelease tags and commits already in main history", () => {
  const { cwd, env, git } = fixture("1.2.3-beta.1");
  git("commit", "--allow-empty", "-m", "next main commit");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "--detach", env.GITHUB_SHA);
  assert.equal(prepareRelease(cwd, env).prerelease, true);
});

test("rejects manual runs, branch pushes and malformed version tags", () => {
  const { cwd, env } = fixture();
  assert.throws(
    () => prepareRelease(cwd, { ...env, GITHUB_EVENT_NAME: "workflow_dispatch" }),
    /push/,
  );
  assert.throws(() => prepareRelease(cwd, { ...env, GITHUB_REF_TYPE: "branch" }), /版本标签/);
  assert.throws(() => prepareRelease(cwd, { ...env, GITHUB_REF_NAME: "v01.2.3" }), /vX.Y.Z/);
});

test("rejects feature commits that have not entered main", () => {
  const { cwd, env, git } = fixture();
  git("checkout", "-b", "feature");
  git("commit", "--allow-empty", "-m", "unmerged feature");
  git("tag", "-f", env.GITHUB_REF_NAME);
  env.GITHUB_SHA = git("rev-parse", "HEAD");
  assert.throws(() => prepareRelease(cwd, env), /尚未合并到 main/);
});

test("rejects a tag moved after the workflow was triggered", () => {
  const { cwd, env, git } = fixture();
  git("commit", "--allow-empty", "-m", "moved tag");
  git("tag", "-f", env.GITHUB_REF_NAME);
  git("checkout", "--detach", env.GITHUB_SHA);
  assert.throws(() => prepareRelease(cwd, env), /标签已移动/);
});

test("rejects inconsistent package versions and missing release notes", () => {
  const { cwd, env, write } = fixture();
  write("apps/desktop/package.json", JSON.stringify({ version: "1.2.2" }));
  assert.throws(() => prepareRelease(cwd, env), /apps\/desktop\/package.json/);
  write("apps/desktop/package.json", JSON.stringify({ version: "1.2.3" }));
  write("CHANGELOG.md", "# 更新记录\n\n## 1.2.2\n\n旧内容。\n");
  assert.throws(() => prepareRelease(cwd, env), /缺少 1.2.3/);
});

test("distinguishes a missing release, a resumable draft and a published version", async () => {
  for (const [status, body, expected] of [
    [404, {}, "absent"],
    [200, { draft: true }, "draft"],
    [200, { draft: false }, "published"],
  ]) {
    const request = async () => new Response(JSON.stringify(body), { status });
    assert.equal(await releaseState("owner/repo", "v1.2.3", "test-token", request), expected);
  }
  const unavailable = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(
    () => releaseState("owner/repo", "v1.2.3", "test-token", unavailable),
    /503/,
  );
});
