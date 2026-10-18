import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

process.env.DATABASE_URL = join(mkdtempSync(join(tmpdir(), "aigc-recovery-")), "test.db");
const { db } = await import("../db");
const { projects, agentRuns, agentCommands, generationJobs } = await import("../db/schema");
const { recoverInterruptedWork } = await import("./recovery");
migrate(db, { migrationsFolder: "./drizzle" });
test("restart marks unfinished work unknown and never replays it", () => {
  const project = db.insert(projects).values({ name: "recovery" }).returning().get();
  db.insert(agentRuns)
    .values({
      id: "run",
      projectId: project.id,
      requestId: "request",
      clientId: "old-client",
      status: "running",
    })
    .run();
  db.insert(agentCommands)
    .values({ id: "command", runId: "run", name: "create_nodes", args: "{}", status: "pending" })
    .run();
  db.insert(generationJobs)
    .values({
      id: "job",
      projectId: project.id,
      nodeId: "node",
      requestId: "generation",
      kind: "image",
      input: "{}",
      status: "running",
    })
    .run();
  recoverInterruptedWork();
  assert.equal(db.select().from(agentRuns).get()?.status, "interrupted");
  assert.equal(db.select().from(agentCommands).get()?.status, "unknown");
  assert.equal(db.select().from(generationJobs).get()?.status, "unknown");
  db.insert(agentRuns)
    .values({
      id: "new",
      projectId: project.id,
      requestId: "next",
      clientId: "new-client",
      status: "running",
    })
    .run();
  recoverInterruptedWork();
  assert.equal(
    db
      .select()
      .from(agentRuns)
      .all()
      .find((row) => row.id === "new")?.status,
    "running",
  );
});
