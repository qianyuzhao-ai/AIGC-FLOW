import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

const databasePath = join(mkdtempSync(join(tmpdir(), "pi-rename-")), "test.db");
process.env.DATABASE_URL = databasePath;
const { app } = await import("../app");
const { db } = await import("../db");
const { projects } = await import("../db/schema");
const { createConversation, getConversation, touchConversation } = await import("./conversations");
migrate(db, { migrationsFolder: "./drizzle" });
const first = db.insert(projects).values({ name: "rename test" }).returning().get();
const second = db.insert(projects).values({ name: "other project" }).returning().get();
const conversation = createConversation(first.id);
const path = `/api/pi/projects/${first.id}/conversations/${conversation.id}`;
const rename = (title: string, url = path) =>
  app.request(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });

test("rename trims and persists the title without changing conversation identity or activity time", async () => {
  const response = await rename("  分镜设计讨论  ");
  assert.equal(response.status, 200);
  const saved = (await response.json()) as { id: string; title: string; updatedAt: string };
  assert.equal(saved.id, conversation.id);
  assert.equal(saved.title, "分镜设计讨论");
  assert.equal(saved.updatedAt, conversation.updatedAt);
  const reopened = new Database(databasePath, { readonly: true });
  try {
    assert.deepEqual(
      reopened
        .prepare("SELECT title, title_customized FROM agent_conversations WHERE id = ?")
        .get(conversation.id),
      { title: "分镜设计讨论", title_customized: 1 },
    );
  } finally {
    reopened.close();
  }
});

test("custom names including default labels survive later messages", async () => {
  for (const title of ["新对话", "历史对话", "我的讨论"]) {
    assert.equal((await rename(title)).status, 200);
    touchConversation(conversation.id, "这一条消息不应该覆盖手动标题");
    assert.equal(getConversation(first.id, conversation.id).title, title);
  }
  const automatic = createConversation(first.id);
  touchConversation(automatic.id, "第一条消息仍可以自动命名");
  assert.equal(getConversation(first.id, automatic.id).title, "第一条消息仍可以自动命名");
});

test("rename rejects invalid names and another project's conversations", async () => {
  for (const title of ["", "   ", "x".repeat(101)]) assert.equal((await rename(title)).status, 400);
  assert.equal(
    (await rename("不能跨项目", path.replace(`/projects/${first.id}/`, `/projects/${second.id}/`)))
      .status,
    400,
  );
  assert.equal(getConversation(first.id, conversation.id).title, "我的讨论");
});
