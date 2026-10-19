import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./publish-release.sh", import.meta.url));

function publish({
  state = "absent",
  failUpload = false,
  missingPackage = false,
  missingFile,
} = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "aigc publish "));
  mkdirSync(join(cwd, "bin"));
  mkdirSync(join(cwd, "dist"));
  writeFileSync(join(cwd, "RELEASE_NOTES.md"), "Release notes");
  const files = [
    "AIGC-FLOW-1.2.3-arm64.dmg",
    "AIGC-FLOW-1.2.3.dmg",
    "AIGC-FLOW-1.2.3-arm64-mac.zip",
    "AIGC-FLOW-1.2.3-mac.zip",
    "AIGC-FLOW.Setup.1.2.3.exe",
    "latest-mac.yml",
    "latest.yml",
    "AIGC-FLOW-1.2.3-arm64.dmg.blockmap",
    "AIGC-FLOW-1.2.3.dmg.blockmap",
    "AIGC-FLOW-1.2.3-arm64-mac.zip.blockmap",
    "AIGC-FLOW-1.2.3-mac.zip.blockmap",
    "AIGC-FLOW.Setup.1.2.3.exe.blockmap",
  ];
  for (const file of files.filter(
    (file) => file !== missingFile && !(missingPackage && file.endsWith(".exe")),
  )) {
    writeFileSync(join(cwd, "dist", file), `fixture ${file}`);
  }
  const log = join(cwd, "calls.jsonl");
  writeFileSync(
    join(cwd, "bin", "gh"),
    `#!/usr/bin/env node
    const args = process.argv.slice(2);
    require("node:fs").appendFileSync(process.env.TEST_LOG, JSON.stringify(args) + "\\n");
    if (args[1] === "upload" && process.env.TEST_FAIL_UPLOAD === "1") process.exitCode = 1;
  `,
    { mode: 0o755 },
  );
  const result = spawnSync("bash", [script], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${join(cwd, "bin")}${delimiter}${process.env.PATH}`,
      TAG: "v1.2.3",
      VERSION: "1.2.3",
      PRERELEASE: "false",
      RELEASE_STATE: state,
      GITHUB_REPOSITORY: "test/repo",
      TEST_LOG: log,
      TEST_FAIL_UPLOAD: failUpload ? "1" : "0",
    },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) : [];
  return { cwd, result, calls, files };
}

test("publishes only after installers, update metadata, blockmaps and checksums are uploaded", () => {
  const { cwd, result, calls, files } = publish();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    calls.map((args) => args[1]),
    ["create", "upload", "edit"],
  );
  assert.ok(calls[0].includes("--draft"));
  assert.ok(calls[0].includes("--verify-tag"));
  assert.ok(calls[2].includes("--draft=false"));
  for (const file of files) assert.ok(calls[1].includes(file));
  const checksums = readFileSync(join(cwd, "dist/aigc-flow-v1.2.3-SHA256SUMS.txt"), "utf8");
  assert.equal(checksums.trim().split("\n").length, files.length);
  for (const file of files) {
    const digest = createHash("sha256").update(`fixture ${file}`).digest("hex");
    assert.ok(checksums.includes(`${digest}  ${file}\n`));
  }
});

test("upload failure keeps the release unpublished; retry resumes the draft", () => {
  const failed = publish({ failUpload: true });
  assert.notEqual(failed.result.status, 0);
  assert.deepEqual(
    failed.calls.map((args) => args[1]),
    ["create", "upload"],
  );
  const retried = publish({ state: "draft" });
  assert.equal(retried.result.status, 0, retried.result.stderr);
  assert.deepEqual(
    retried.calls.map((args) => args[1]),
    ["edit", "upload", "edit"],
  );
  assert.ok(retried.calls.at(-1).includes("--draft=false"));
});

test("missing packages and published versions cannot upload or publish", () => {
  for (const options of [
    { missingPackage: true },
    { state: "published" },
    { missingFile: "latest-mac.yml" },
    { missingFile: "latest.yml" },
    { missingFile: "AIGC-FLOW.Setup.1.2.3.exe.blockmap" },
  ]) {
    const { result, calls } = publish(options);
    assert.notEqual(result.status, 0);
    assert.deepEqual(calls, []);
  }
});
