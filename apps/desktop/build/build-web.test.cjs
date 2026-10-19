const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, readFileSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");

test("local web build sets DESKTOP across platforms and preserves pnpm arguments and failures", () => {
  const directory = mkdtempSync(join(tmpdir(), "aigc local build "));
  const pnpm = join(directory, "pnpm.cjs");
  const output = join(directory, "invocation.json");
  writeFileSync(
    pnpm,
    `
    require("node:fs").writeFileSync(process.env.TEST_OUTPUT,
      JSON.stringify({ args: process.argv.slice(2), desktop: process.env.DESKTOP }));
    process.exitCode = Number(process.env.TEST_EXIT_CODE);
  `,
  );
  for (const status of [0, 7]) {
    const result = spawnSync(process.execPath, [join(__dirname, "build-web.cjs"), "--webpack"], {
      env: {
        ...process.env,
        npm_execpath: pnpm,
        TEST_OUTPUT: output,
        TEST_EXIT_CODE: String(status),
      },
    });
    assert.equal(result.status, status, result.stderr?.toString());
    assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), {
      args: ["--filter", "@aigc-flow/client", "run", "build", "--webpack"],
      desktop: "1",
    });
  }
});
