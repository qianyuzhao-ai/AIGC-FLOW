const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { createReadStream, readFileSync, statSync } = require("node:fs");
const { join, resolve } = require("node:path");
const { load } = require("js-yaml");

async function verifyUpdateMetadata(directory, platform, version) {
  const mac = platform === "darwin";
  assert.ok(mac || platform === "win32", `Unsupported platform: ${platform}`);
  const expected = mac
    ? [
        `AIGC-FLOW-${version}-arm64-mac.zip`,
        `AIGC-FLOW-${version}-mac.zip`,
        `AIGC-FLOW-${version}-arm64.dmg`,
        `AIGC-FLOW-${version}.dmg`,
      ]
    : [`AIGC-FLOW.Setup.${version}.exe`];
  const manifest = load(
    readFileSync(join(directory, mac ? "latest-mac.yml" : "latest.yml"), "utf8"),
  );
  assert.equal(manifest.version, version, "更新清单版本与安装包版本不一致");
  assert.deepEqual(
    manifest.files.map((file) => file.url).sort(),
    expected.sort(),
    "更新清单缺少架构或包含非本轮产物",
  );
  for (const file of manifest.files) {
    const path = join(directory, file.url);
    const hash = createHash("sha512");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    assert.equal(hash.digest("base64"), file.sha512, `${file.url} 的 SHA-512 不匹配`);
    if (file.size !== undefined) assert.equal(statSync(path).size, file.size);
    assert.ok(statSync(`${path}.blockmap`).size > 0, `${file.url} 缺少 blockmap`);
  }
  const legacy = manifest.files.find((file) => file.url === manifest.path);
  assert.ok(legacy, "更新清单的 path 未包含在 files 中");
  assert.equal(manifest.sha512, legacy.sha512);
  console.log(`PASS ${platform} update metadata: ${version}, ${expected.length} artifacts`);
}

module.exports = { verifyUpdateMetadata };
if (require.main === module) {
  const directory = process.argv[2] ? resolve(process.argv[2]) : resolve(__dirname, "../release");
  const { version } = require("../package.json");
  verifyUpdateMetadata(directory, process.platform, version).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
