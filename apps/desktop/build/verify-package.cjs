const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { cpSync, mkdtempSync, readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

async function verifyRuntime(archive, expectedVersion) {
  const packagedRequire = createRequire(join(archive, "package.json"));
  assert.equal(packagedRequire("./package.json").version, expectedVersion);
  const Database = packagedRequire("better-sqlite3");
  const db = new Database(":memory:");
  assert.equal(db.prepare("select 1 as value").get().value, 1);
  db.close();
  const updater = packagedRequire("electron-updater");
  assert.equal(typeof updater.MacUpdater, "function");
  assert.equal(typeof updater.NsisUpdater, "function");

  const sdkRoot = join(archive, "node_modules", "@earendil-works", "pi-coding-agent");
  const metadata = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8"));
  const sdk = await import(pathToFileURL(join(sdkRoot, metadata.exports["."].import)).href);
  assert.equal(typeof sdk.createAgentSession, "function");
  assert.equal(typeof sdk.SessionManager.continueRecent, "function");
  console.log(`PASS packaged ${expectedVersion}: SQLite, updater and Pi ESM SDK`);
}

async function main() {
  if (process.argv[2] === "--runtime") {
    await verifyRuntime(process.argv[3], process.argv[4]);
    return;
  }

  const desktop = resolve(__dirname, "..");
  const release = process.argv[2] ? resolve(process.argv[2]) : join(desktop, "release");
  const { version } = JSON.parse(readFileSync(join(desktop, "package.json"), "utf8"));
  let executable;
  let resources;
  if (process.platform === "darwin") {
    const output = process.arch === "arm64" ? "mac-arm64" : "mac";
    const contents = join(release, output, "AIGC-FLOW.app", "Contents");
    executable = join(contents, "MacOS", "AIGC-FLOW");
    resources = join(contents, "Resources");
  } else if (process.platform === "win32") {
    const output = join(release, "win-unpacked");
    executable = join(output, "AIGC-FLOW.exe");
    resources = join(output, "resources");
  } else {
    throw new Error(`Unsupported release platform: ${process.platform}`);
  }

  // 隔离到临时目录，避免缺失的依赖被仓库 node_modules 补上，导致检查误通过。
  const isolated = mkdtempSync(join(tmpdir(), "aigc-flow-package-"));
  for (const name of ["app.asar", "app.asar.unpacked"]) {
    cpSync(join(resources, name), join(isolated, name), { recursive: true });
  }
  const result = spawnSync(
    executable,
    [__filename, "--runtime", join(isolated, "app.asar"), version],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: "inherit",
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `Packaged runtime check failed; files: ${isolated}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
