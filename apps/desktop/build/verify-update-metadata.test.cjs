const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdtempSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { test } = require("node:test");
const { dump } = require("js-yaml");
const { verifyUpdateMetadata } = require("./verify-update-metadata.cjs");

test("release metadata requires both Mac architectures and matching installer hashes", async () => {
  const directory = mkdtempSync(join(tmpdir(), "aigc-update-manifest-"));
  const files = ["1.0.0-arm64-mac.zip", "1.0.0-mac.zip", "1.0.0-arm64.dmg", "1.0.0.dmg"].map(
    (name) => {
      const url = `AIGC-FLOW-${name}`;
      writeFileSync(join(directory, url), url);
      writeFileSync(join(directory, `${url}.blockmap`), "blockmap");
      return {
        url,
        sha512: createHash("sha512").update(url).digest("base64"),
        size: Buffer.byteLength(url),
      };
    },
  );
  const manifest = { version: "1.0.0", files, path: files[0].url, sha512: files[0].sha512 };
  const save = () => writeFileSync(join(directory, "latest-mac.yml"), dump(manifest));
  save();
  await verifyUpdateMetadata(directory, "darwin", "1.0.0");
  await assert.rejects(verifyUpdateMetadata(directory, "darwin", "1.0.1"), /版本/);
  manifest.files = files.slice(1);
  save();
  await assert.rejects(verifyUpdateMetadata(directory, "darwin", "1.0.0"), /缺少架构/);
  manifest.files = files;
  save();
  writeFileSync(join(directory, files[0].url), "corrupted download");
  await assert.rejects(verifyUpdateMetadata(directory, "darwin", "1.0.0"), /SHA-512/);
});
