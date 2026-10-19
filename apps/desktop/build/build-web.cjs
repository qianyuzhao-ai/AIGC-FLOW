const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

assert.ok(process.env.npm_execpath, "请通过 pnpm run build:web 构建前端");
const result = spawnSync(
  process.execPath,
  [
    process.env.npm_execpath,
    "--filter",
    "@aigc-flow/client",
    "run",
    "build",
    ...process.argv.slice(2),
  ],
  { env: { ...process.env, DESKTOP: "1" }, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
