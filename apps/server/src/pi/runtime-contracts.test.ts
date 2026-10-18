import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canvasToolSchemas, EMPTY_GRAPH } from "@aigc-flow/shared";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const directory = mkdtempSync(join(tmpdir(), "aigc-agent-contracts-"));
process.env.DATABASE_URL = join(directory, "test.db");
const { app } = await import("../app");
const { db } = await import("../db");
migrate(db, { migrationsFolder: "./drizzle" });
test("graph saves use compare-and-swap and reject stale overwrites", async () => {
  const created = await app.request("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "versioned" }),
  });
  const project = (await created.json()) as { id: number };
  const path = `/api/projects/${project.id}/graph`;
  const first = await app.request(path);
  assert.deepEqual(await first.json(), { graph: EMPTY_GRAPH, version: 0 });
  const save = () =>
    app.request(path, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ graph: EMPTY_GRAPH, expectedVersion: 0 }),
    });
  assert.equal((await save()).status, 200);
  assert.equal((await save()).status, 409);
});
test("tool edits cannot set fabricated generation results", () => {
  assert.equal(
    canvasToolSchemas.update_nodes.safeParse({ updates: [{ nodeId: "a", resultUrl: "fake" }] })
      .success,
    false,
  );
});
