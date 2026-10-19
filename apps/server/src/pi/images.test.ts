import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { crc32, deflateSync } from "node:zlib";
import { startAgentRunSchema } from "@aigc-flow/shared";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "pi-thumbnails-")), "test.db");
process.env.PI_OFFLINE = "1";
const { app } = await import("../app");
const { getPiRuntime } = await import("./runtime");

function largePng() {
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name);
    const size = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1920);
  header.writeUInt32BE(1080, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1920 * 3 + 1, 120);
  row[0] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: 1080 }, () => row)))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

test("chat thumbnails are at most 854 by 480 and reuse the thumbnail cache", async (t) => {
  const source = largePng();
  let downloads = 0;
  t.mock.method(globalThis, "fetch", async () => {
    downloads++;
    return new Response(source, { headers: { "Content-Type": "image/png" } });
  });
  const url = `/api/pi/thumbnail?url=${encodeURIComponent("https://test.bcebos.com/large.png")}`;
  const response = await app.request(url);
  assert.equal(response.status, 200);
  const { sdk } = await getPiRuntime();
  const image = await sdk.resizeImage(
    Buffer.from(await response.arrayBuffer()),
    response.headers.get("content-type") ?? "",
  );
  assert.ok(image && image.originalWidth <= 854 && image.originalHeight <= 480);
  assert.ok(image.originalWidth > 800 && image.originalHeight > 450);
  assert.equal((await app.request(url)).status, 200);
  assert.equal(downloads, 1);
  assert.equal((await app.request("/api/pi/thumbnail?url=http://127.0.0.1/private")).status, 400);
  assert.equal(downloads, 1);
});

test("Pi accepts nine attachments and rejects a tenth", () => {
  const input = {
    message: "compare",
    clientId: "client",
    requestId: "request",
    imageNodeIds: Array.from({ length: 9 }, (_, i) => String(i)),
  };
  assert.equal(startAgentRunSchema.safeParse(input).success, true);
  assert.equal(
    startAgentRunSchema.safeParse({ ...input, imageNodeIds: [...input.imageNodeIds, "10"] })
      .success,
    false,
  );
});
