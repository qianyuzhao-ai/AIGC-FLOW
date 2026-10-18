import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { piChatMessageSchema } from "@aigc-flow/shared";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import { readPiStream } from "../../../client/src/lib/pi-stream";

const historySchema = z.object({ messages: z.array(piChatMessageSchema), running: z.boolean() });
const configurationSchema = z.object({
  provider: z.string(),
  model: z.string(),
  providers: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      configured: z.boolean(),
      custom: z.object({ baseUrl: z.string(), api: z.string() }).optional(),
      models: z.array(
        z.object({ id: z.string(), contextWindow: z.number(), maxTokens: z.number() }),
      ),
    }),
  ),
});
async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

const directory = mkdtempSync(join(tmpdir(), "aigc-flow-pi-test-"));
process.env.DATABASE_URL = join(directory, "test.db");
process.env.PI_OFFLINE = "1";

const { app } = await import("../app");
const { db } = await import("../db");
const { projects } = await import("../db/schema");
const { getPiRuntime } = await import("./runtime");
const { getProjectSession, chatMessages } = await import("./sessions");
migrate(db, { migrationsFolder: "./drizzle" });
const first = db.insert(projects).values({ name: "Pi test" }).returning().get();
const second = db.insert(projects).values({ name: "Other project" }).returning().get();

const received: { authorization?: string; body: Record<string, unknown> }[] = [];
const modelRequests: { url: string | undefined; authorization?: string }[] = [];
const upstream = createServer(async (request, response) => {
  if (request.method === "GET") {
    modelRequests.push({ url: request.url, authorization: request.headers.authorization });
    if (request.url === "/unavailable/models") {
      response.writeHead(404);
      response.end();
      return;
    }
    if (request.url === "/redirect/models") {
      response.writeHead(302, { Location: "/v1/models" });
      response.end();
      return;
    }
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        data:
          request.url === "/empty/models"
            ? []
            : [
                { id: "test-model", name: "测试模型" },
                { id: "vendor/chat-model", name: "跨服务模型" },
                { id: "test-model" },
                { id: "" },
              ],
      }),
    );
    return;
  }
  let input = "";
  for await (const part of request) input += part.toString();
  const body = JSON.parse(input);
  received.push({ authorization: request.headers.authorization, body });
  const content = body.messages.at(-1).content;
  const last =
    typeof content === "string"
      ? content
      : content.map((part: { text?: string }) => part.text ?? "").join("");
  if (last === "fail") {
    response.writeHead(401, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "mock invalid credential" } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/event-stream" });
  const chunk = (delta: Record<string, string>, finishReason: string | null = null) => {
    response.write(
      `data: ${JSON.stringify({
        id: "mock",
        object: "chat.completion.chunk",
        created: 1,
        model: "test-model",
        choices: [{ index: 0, delta, finish_reason: finishReason }],
      })}\n\n`,
    );
  };
  chunk({ role: "assistant", content: "你好" });
  const timer = setTimeout(
    () => {
      chunk({ content: "，Pi 已连接。" });
      chunk({}, "stop");
      response.end("data: [DONE]\n\n");
    },
    last === "slow" ? 10_000 : 20,
  );
  response.on("close", () => clearTimeout(timer));
});

function jsonRequest(path: string, body: unknown, method = "POST") {
  return app.request(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("Pi configuration and project conversation", async (t) => {
  await new Promise<void>((resolve, reject) => {
    upstream.once("error", reject);
    upstream.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => {
    upstream.closeAllConnections();
    upstream.close();
    db.$client.close();
  });
  const address = upstream.address();
  assert.ok(address && typeof address !== "string");
  const connection = {
    provider: "custom-test",
    model: "test-model",
    apiKey: "pi-test-only-key",
    clearApiKey: false,
    custom: {
      name: "测试聚合服务",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      api: "openai-completions",
      contextWindow: 32768,
      maxTokens: 1024,
    },
  };
  const chatPath = `/api/pi/projects/${first.id}/messages`;

  await t.test("removes only obsolete settings and routes", async () => {
    const legacy = new Database(":memory:");
    legacy.exec(
      "CREATE TABLE settings (key TEXT, value TEXT); INSERT INTO settings VALUES ('llm_api_key', 'old'), ('llm_base_url', 'old'), ('llm_model', 'old'), ('req_from', 'keep');",
    );
    legacy.exec(readFileSync("./drizzle/0005_remove-legacy-llm.sql", "utf8"));
    assert.deepEqual(legacy.prepare("SELECT * FROM settings").all(), [
      { key: "req_from", value: "keep" },
    ]);
    legacy.close();
    assert.equal((await app.request("/api/llm/models", { method: "POST" })).status, 404);
    assert.equal(
      (await app.request("/api/storyboard/performance-prompts", { method: "POST" })).status,
      404,
    );
    const settings = z
      .record(z.string(), z.unknown())
      .parse(await (await app.request("/api/settings")).json());
    assert.equal("llmApiKey" in settings, false);
  });
  await t.test("saves a Pi provider without requiring internal service settings", async () => {
    const response = await jsonRequest("/api/pi/configuration", connection, "PUT");
    assert.equal(response.status, 200, await response.clone().text());
    const body = await response.json();
    const view = configurationSchema.parse(body);
    assert.equal(view.provider, "custom-test");
    assert.equal(view.model, "test-model");
    const provider = view.providers.find((item) => item.id === "custom-test");
    assert.equal(provider?.name, "测试聚合服务");
    assert.deepEqual(provider?.custom, {
      baseUrl: connection.custom.baseUrl,
      api: "openai-completions",
    });
    assert.deepEqual(provider?.models[0], {
      id: "test-model",
      contextWindow: 32768,
      maxTokens: 1024,
    });
    assert.equal(
      view.providers.find((provider) => provider.id === "custom-test")?.configured,
      true,
    );
    assert.equal(JSON.stringify(body).includes(connection.apiKey), false);
    const { sdk } = await getPiRuntime();
    const reopened = await sdk.ModelRuntime.create({
      authPath: join(directory, "pi/auth.json"),
      modelsPath: join(directory, "pi/models.json"),
    });
    assert.equal(reopened.hasConfiguredAuth("custom-test"), true);
  });
  await t.test(
    "discovers aggregate models with an unsaved key and preserves exact model IDs",
    async () => {
      const response = await jsonRequest("/api/pi/models", {
        provider: "custom-unsaved",
        baseUrl: `${connection.custom.baseUrl}/`,
        apiKey: "unsaved-test-key",
      });
      assert.equal(response.status, 200, await response.clone().text());
      assert.deepEqual(await response.json(), {
        models: [
          { id: "test-model", name: "测试模型" },
          { id: "vendor/chat-model", name: "跨服务模型" },
        ],
      });
      assert.deepEqual(modelRequests.at(-1), {
        url: "/v1/models",
        authorization: "Bearer unsaved-test-key",
      });
      assert.equal((await getPiRuntime()).models.getProvider("custom-unsaved"), undefined);
    },
  );
  await t.test("reuses only the saved key bound to the requested aggregate endpoint", async () => {
    const response = await jsonRequest("/api/pi/models", {
      provider: "custom-test",
      baseUrl: connection.custom.baseUrl,
      apiKey: "",
    });
    assert.equal(response.status, 200);
    assert.equal(modelRequests.at(-1)?.authorization, "Bearer pi-test-only-key");
    const count = modelRequests.length;
    const changedUrl = connection.custom.baseUrl.replace("/v1", "/other/v1");
    const blocked = await jsonRequest("/api/pi/models", {
      provider: "custom-test",
      baseUrl: changedUrl,
      apiKey: "",
    });
    assert.equal(blocked.status, 400);
    assert.equal(modelRequests.length, count);
    const explicitKey = await jsonRequest("/api/pi/models", {
      provider: "custom-test",
      baseUrl: changedUrl,
      apiKey: "other-test-key",
    });
    assert.equal(explicitKey.status, 200);
    assert.deepEqual(modelRequests.at(-1), {
      url: "/other/v1/models",
      authorization: "Bearer other-test-key",
    });
  });
  await t.test(
    "allows manual model entry when discovery is unavailable and never follows redirects",
    async () => {
      for (const path of ["unavailable", "empty", "redirect"]) {
        const count = modelRequests.length;
        const response = await jsonRequest("/api/pi/models", {
          provider: "custom-unsaved",
          baseUrl: connection.custom.baseUrl.replace("v1", path),
          apiKey: "test-only",
        });
        assert.equal(response.status, 400);
        assert.equal(modelRequests.length, count + 1);
      }
      const saved = await jsonRequest(
        "/api/pi/configuration",
        {
          ...connection,
          model: "manual-model-id",
          apiKey: "",
        },
        "PUT",
      );
      assert.equal(saved.status, 200);
      assert.ok((await getPiRuntime()).models.getModel("custom-test", "manual-model-id"));
      await jsonRequest("/api/pi/configuration", connection, "PUT");
    },
  );
  await t.test("rejects reusing a key at a new endpoint and command-valued keys", async () => {
    const response = await jsonRequest(
      "/api/pi/configuration",
      {
        ...connection,
        apiKey: "",
        custom: { ...connection.custom, baseUrl: "http://localhost:1/v1" },
      },
      "PUT",
    );
    assert.equal(response.status, 400);
    assert.equal(
      (await jsonRequest("/api/pi/configuration", { ...connection, apiKey: "!echo nope" }, "PUT"))
        .status,
      400,
    );
  });
  await t.test("keeps other models when adding to the same custom provider", async () => {
    const response = await jsonRequest(
      "/api/pi/configuration",
      {
        ...connection,
        model: "second-model",
        apiKey: "",
      },
      "PUT",
    );
    assert.equal(response.status, 200);
    const { models } = await getPiRuntime();
    assert.ok(models.getModel("custom-test", "test-model"));
    assert.ok(models.getModel("custom-test", "second-model"));
    const restored = await jsonRequest(
      "/api/pi/configuration",
      {
        provider: "custom-test",
        model: "test-model",
        apiKey: "",
        clearApiKey: false,
      },
      "PUT",
    );
    assert.equal(restored.status, 200);
  });
  await t.test("verifies through Pi and sends the key only upstream", async () => {
    const response = await app.request("/api/pi/verify", { method: "POST" });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal(
      z.object({ reply: z.string() }).parse(await response.json()).reply,
      "你好，Pi 已连接。",
    );
    assert.equal(received.at(-1)?.authorization, "Bearer pi-test-only-key");
  });
  await t.test("streams text, persists history, and isolates projects", async () => {
    const response = await jsonRequest(chatPath, { message: "hello" });
    assert.equal(response.status, 200, await response.clone().text());
    const events = await collect(readPiStream(response));
    assert.equal(
      events
        .filter((event) => event.type === "text")
        .map((event) => event.delta)
        .join(""),
      "你好，Pi 已连接。",
    );
    const history = historySchema.parse(await (await app.request(chatPath)).json());
    assert.deepEqual(
      history.messages.map((message: { text: string }) => message.text),
      ["hello", "你好，Pi 已连接。"],
    );
    const other = historySchema.parse(
      await (await app.request(`/api/pi/projects/${second.id}/messages`)).json(),
    );
    assert.deepEqual(other.messages, []);
    const session = await getProjectSession(first.id);
    assert.deepEqual(session.getActiveToolNames(), []);
    const file = session.sessionManager.getSessionFile();
    assert.ok(file);
    const { sdk } = await getPiRuntime();
    assert.ok(
      sdk.SessionManager.open(file)
        .getBranch()
        .some((entry) => entry.type === "message" && entry.message.role === "user"),
    );
    assert.equal(received.at(-1)?.body.tools, undefined);
  });
  await t.test("rejects concurrent prompts and cancels generation", async () => {
    const response = await jsonRequest(chatPath, { message: "slow" });
    const iterator = readPiStream(response);
    const initial = await iterator.next();
    assert.equal(initial.value?.type, "text");
    assert.equal((await jsonRequest(chatPath, { message: "duplicate" })).status, 409);
    assert.equal(
      (await app.request(`/api/pi/projects/${first.id}/abort`, { method: "POST" })).status,
      200,
    );
    const remaining = await collect(iterator);
    assert.ok(remaining.some((event) => event.type === "done"));
    assert.equal(historySchema.parse(await (await app.request(chatPath)).json()).running, false);
  });
  await t.test("reports model errors and rejects unknown projects", async () => {
    const events = await collect(readPiStream(await jsonRequest(chatPath, { message: "fail" })));
    assert.ok(events.some((event) => event.type === "error"));
    assert.equal(
      (await jsonRequest("/api/pi/projects/9999/messages", { message: "hello" })).status,
      404,
    );
    assert.ok(chatMessages(await getProjectSession(first.id)).length >= 4);
  });
});

test("SSE parser handles UTF-8 split between chunks and detects a truncated response", async () => {
  const bytes = new TextEncoder().encode(
    'data: {"type":"text","delta":"中文"}\n\ndata: {"type":"done","messages":[]}\n\n',
  );
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      controller.close();
    },
  });
  assert.deepEqual(await collect(readPiStream(new Response(stream))), [
    { type: "text", delta: "中文" },
    { type: "done", messages: [] },
  ]);
  await assert.rejects(
    () => collect(readPiStream(new Response('data: {"type":"text","delta":"partial"}\n\n'))),
    /连接中断/,
  );
});
