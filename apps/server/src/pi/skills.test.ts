import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { piSkillPreviewSchema } from "@aigc-flow/shared";
import { skillManifest, skillZip } from "./skills/test-archive";

const directory = mkdtempSync(join(tmpdir(), "pi-skills-"));
process.env.DATABASE_URL = join(directory, "test.db");
process.env.PI_OFFLINE = "1";
const { app } = await import("../app");
const { readSkillText, skillsRoot } = await import("./skills/store");
function json(path: string, body: unknown, method = "POST") {
  return app.request(`/api/pi/skills${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function preview(bytes: Buffer) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], "example.skill"));
  return app.request("/api/pi/skills/preview", { method: "POST", body: form });
}

test("preview does not write files; installation preserves the package and refuses overwrites", async () => {
  const manifest = skillManifest("scene-review");
  const bytes = skillZip([
    { name: "example/SKILL.md", content: manifest },
    { name: "example/references/checklist.md", content: "Check composition." },
    { name: "example/scripts/task.js", content: "throw new Error('must never execute');" },
  ]);
  const response = await preview(bytes);
  assert.equal(response.status, 200, await response.clone().text());
  const value = piSkillPreviewSchema.parse(await response.json());
  assert.equal(value.skills.length, 1);
  assert.equal(existsSync(join(skillsRoot, "scene-review")), false);
  assert.equal(value.skills[0]?.warnings.length, 1);
  const input = { previewId: value.id, skillId: value.skills[0]?.id };
  assert.equal((await json("/install", input)).status, 201);
  assert.equal(readSkillText("scene-review"), manifest);
  assert.equal(readSkillText("scene-review", "references/checklist.md"), "Check composition.");
  assert.equal(
    readFileSync(join(skillsRoot, "scene-review/scripts/task.js"), "utf8"),
    "throw new Error('must never execute');",
  );
  assert.equal((await json("/install", input)).status, 400);
  assert.equal(readSkillText("scene-review"), manifest);
  assert.equal((await json("/scene-review", { enabled: false }, "PATCH")).status, 200);
  assert.throws(() => readSkillText("scene-review"), /已停用/);
  assert.equal((await json("/scene-review", { enabled: true }, "PATCH")).status, 200);
  assert.throws(() => readSkillText("scene-review", "../../auth.json"), /路径/);
  assert.throws(() => readSkillText("scene-review", "unknown.md"), /清单/);
  const reference = join(skillsRoot, "scene-review/references/checklist.md");
  renameSync(reference, `${reference}.original`);
  const outside = join(directory, "outside.txt");
  writeFileSync(outside, "private");
  symlinkSync(outside, reference);
  assert.throws(() => readSkillText("scene-review", "references/checklist.md"), /符号链接/);
});

test("archives reject traversal, ambiguous paths, symlinks, malformed metadata and oversized files", async () => {
  assert.equal(
    (await preview(skillZip([{ name: "../outside/SKILL.md", content: skillManifest("bad") }])))
      .status,
    400,
  );
  assert.equal(
    (
      await preview(
        skillZip([
          { name: "a/SKILL.md", content: skillManifest("bad") },
          { name: "a/skill.md", content: "duplicate" },
        ]),
      )
    ).status,
    400,
  );
  for (const entries of [
    [
      { name: "SKILL.md", content: skillManifest("bad") },
      { name: "references/link", content: "/etc/passwd", mode: 0o120777 },
    ],
    [
      {
        name: "SKILL.md",
        content: "---\nname: bad\nname: other\ndescription: duplicate\n---\nBody",
      },
    ],
    [
      { name: "SKILL.md", content: skillManifest("bad") },
      { name: "big.txt", content: "x".repeat(2 * 1024 * 1024 + 1) },
    ],
  ]) {
    const value = piSkillPreviewSchema.parse(await (await preview(skillZip(entries))).json());
    assert.equal(value.skills.length, 0);
    assert.ok(value.issues.length > 0);
  }
  assert.equal(existsSync(join(skillsRoot, "bad")), false);
});

test("GitHub previews pin a commit and only fetch from GitHub hosts", async (t) => {
  const sha = "a".repeat(40);
  const archive = skillZip([
    { name: `repo-${sha}/skills/github-review/SKILL.md`, content: skillManifest("github-review") },
  ]);
  const urls: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    urls.push(url);
    return url.startsWith("https://api.github.com/")
      ? Response.json({ sha })
      : new Response(new Uint8Array(archive));
  });
  assert.equal(
    (await json("/github/preview", { url: "https://github.com.evil.test/a/b" })).status,
    400,
  );
  assert.equal(urls.length, 0);
  const response = await json("/github/preview", {
    url: "https://github.com/example/repo/tree/main/skills/github-review",
  });
  assert.equal(response.status, 200, await response.clone().text());
  const value = piSkillPreviewSchema.parse(await response.json());
  assert.ok(value.source.includes(sha));
  assert.equal(value.skills[0]?.name, "github-review");
  assert.deepEqual(urls, [
    "https://api.github.com/repos/example/repo/commits/main",
    `https://codeload.github.com/example/repo/zip/${sha}`,
  ]);
  assert.equal(
    (await json("/install", { previewId: value.id, skillId: value.skills[0]?.id })).status,
    201,
  );
  assert.equal(urls.length, 2);
});
