import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  agentRunViewSchema,
  DEFAULT_IMAGE_GEN_DATA,
  DEFAULT_VIDEO_GEN_DATA,
  piChatMessageSchema,
} from "@aigc-flow/shared";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { z } from "zod";
import { applyCanvasTool, type CanvasState } from "../../../client/src/lib/agent/canvas-tools";
import { readPiStream } from "../../../client/src/lib/pi-stream";
import { skillManifest, skillZip } from "./skills/test-archive";

const historySchema = z.object({
  messages: z.array(piChatMessageSchema),
  run: agentRunViewSchema.nullable(),
});
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
const { projects, settings } = await import("../db/schema");
const { getPiRuntime } = await import("./runtime");
const { getProjectSession, chatMessages } = await import("./sessions");
migrate(db, { migrationsFolder: "./drizzle" });
const first = db.insert(projects).values({ name: "Pi test" }).returning().get();
const second = db.insert(projects).values({ name: "Other project" }).returning().get();

const received: { authorization?: string; body: Record<string, unknown> }[] = [];
const modelRequests: { url: string | undefined; authorization?: string }[] = [];
let generated = 0;
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
  if (request.url === "/aigc") {
    generated++;
    response.setHeader("content-type", "application/json");
    setTimeout(
      () =>
        response.end(
          JSON.stringify({
            result: {
              status: "success",
              content: [
                `https://example.test/result-${generated}.${body.model_name === "seedance" ? "mp4" : "png"}`,
              ],
            },
          }),
        ),
      50,
    );
    return;
  }
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
  const userIndex = body.messages.findLastIndex(
    (message: { role: string }) => message.role === "user",
  );
  if (JSON.stringify(body.messages[userIndex]?.content).includes("use-installed-skill")) {
    const count = body.messages
      .slice(userIndex + 1)
      .filter((message: { role: string }) => message.role === "tool").length;
    if (count < 2) {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: `skill-${count}`, type: "function", function: { name: "read_skill", arguments: JSON.stringify({ name: "integration-guide", file: count ? "references/checklist.md" : "SKILL.md" }) } }] }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
  }
  if (JSON.stringify(body.messages[userIndex]?.content).includes("tool-loop")) {
    const results = body.messages
      .slice(userIndex + 1)
      .filter((message: { role: string }) => message.role === "tool");
    const count = results.length;
    if (count < 3) {
      const name = ["get_canvas", "create_nodes", "arrange_nodes"][count];
      const args =
        count === 0
          ? {}
          : count === 1
            ? { nodes: [1, 2, 3].map((i) => ({ kind: "image", prompt: `提示词${i}` })) }
            : { nodeIds: JSON.parse(results.at(-1).content).data.nodeIds, layout: "horizontal" };
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        `data: ${JSON.stringify({
          id: "mock",
          object: "chat.completion.chunk",
          created: 1,
          model: body.model,
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: `call-${count}`,
                    type: "function",
                    function: { name, arguments: JSON.stringify(args) },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\ndata: [DONE]\n\n`,
      );
      return;
    }
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
  t.after(async () => {
    await (await getProjectSession(first.id)).waitForIdle();
    await new Promise<void>((resolve) => setImmediate(resolve));
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
  const clientId = "test-client";
  async function startChat(message: string) {
    const response = await jsonRequest(chatPath, {
      message,
      clientId,
      requestId: crypto.randomUUID(),
      selectedNodeIds: [],
    });
    assert.equal(response.status, 202, await response.clone().text());
    return z.object({ runId: z.string() }).parse(await response.json()).runId;
  }
  const eventsFor = (runId: string) =>
    app.request(`/api/pi/projects/${first.id}/runs/${runId}/events?clientId=${clientId}`);
  await t.test("streams text, persists history, and isolates projects", async () => {
    const events = await collect(readPiStream(await eventsFor(await startChat("hello"))));
    assert.ok(events.some((event) => event.type === "partial"));
    const history = historySchema.parse(await (await app.request(chatPath)).json());
    assert.deepEqual(
      history.messages.map((message) => message.text),
      ["hello", "你好，Pi 已连接。"],
    );
    const other = historySchema.parse(
      await (await app.request(`/api/pi/projects/${second.id}/messages`)).json(),
    );
    assert.deepEqual(other.messages, []);
    const session = await getProjectSession(first.id);
    assert.ok(session.getActiveToolNames().includes("create_nodes"));
    assert.ok(!session.getActiveToolNames().includes("bash"));
    assert.ok(session.sessionManager.getSessionFile());
  });
  await t.test(
    "Pi executes tools only after real canvas receipts and enforces project ownership",
    async () => {
      const runId = await startChat("tool-loop");
      let state: CanvasState = {
        nodes: [],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        center: { x: 500, y: 400 },
      };
      let revision = 1;
      const seen = new Set<string>();
      for await (const event of readPiStream(await eventsFor(runId))) {
        if (event.type !== "state") continue;
        for (const command of event.commands.filter(
          (item) => item.status === "pending" && !seen.has(item.id),
        )) {
          seen.add(command.id);
          const next = applyCanvasTool(command, state);
          state = { ...state, ...next };
          if (next.changed) revision++;
          const result = {
            success: true,
            revision,
            applied: next.changed,
            saved: true,
            data: next.data,
          };
          const path = `/api/pi/projects/${first.id}/runs/${runId}/commands/${command.id}/result`;
          assert.equal((await jsonRequest(path, { clientId: "wrong-client", result })).status, 400);
          assert.equal(
            (
              await jsonRequest(path.replace(`/projects/${first.id}/`, `/projects/${second.id}/`), {
                clientId,
                result,
              })
            ).status,
            404,
          );
          assert.equal((await jsonRequest(path, { clientId, result })).status, 200);
          assert.equal((await jsonRequest(path, { clientId, result })).status, 200);
        }
      }
      assert.equal(seen.size, 3);
      const transcript = historySchema.parse(await (await app.request(chatPath)).json());
      assert.deepEqual(
        transcript.messages.at(-1)?.commands.map((command) => command.name),
        ["get_canvas", "create_nodes", "arrange_nodes"],
      );
      assert.equal(state.nodes.length, 3);
      assert.deepEqual(
        state.nodes.map((node) => node.position.x),
        [233, 807, 1381],
      );
      assert.equal(
        historySchema.parse(await (await app.request(chatPath)).json()).run?.status,
        "completed",
      );
    },
  );
  await t.test("rejects concurrent prompts and cancels the specified run", async () => {
    const runId = await startChat("slow");
    const iterator = readPiStream(await eventsFor(runId));
    await iterator.next();
    assert.equal(
      (
        await jsonRequest(chatPath, {
          message: "duplicate",
          clientId,
          requestId: crypto.randomUUID(),
        })
      ).status,
      400,
    );
    assert.equal(
      (await app.request(`/api/pi/projects/${first.id}/runs/${runId}/cancel`, { method: "POST" }))
        .status,
      200,
    );
    const remaining = await collect(iterator);
    assert.ok(
      remaining.some((event) => event.type === "state" && event.run?.status === "cancelled"),
    );
  });
  await t.test("reports model failures without manufacturing successful output", async () => {
    const events = await collect(readPiStream(await eventsFor(await startChat("fail"))));
    assert.ok(events.some((event) => event.type === "state" && event.run?.status === "failed"));
    assert.equal(
      (
        await jsonRequest("/api/pi/projects/9999/messages", {
          message: "hello",
          clientId,
          requestId: crypto.randomUUID(),
        })
      ).status,
      404,
    );
    assert.ok(chatMessages(await getProjectSession(first.id)).length >= 4);
  });
  await t.test("image and video jobs are idempotent and keep real results", async () => {
    db.insert(settings)
      .values([
        { key: "generate_url", value: `http://127.0.0.1:${address.port}/aigc` },
        { key: "req_from", value: "test-only" },
      ])
      .run();
    const initial = (await (await app.request(`/api/projects/${first.id}/graph`)).json()) as {
      version: number;
    };
    const graph = {
      nodes: [
        { id: "image", type: "image-gen", position: { x: 0, y: 0 }, data: DEFAULT_IMAGE_GEN_DATA },
        {
          id: "video",
          type: "video-gen",
          position: { x: 600, y: 0 },
          data: DEFAULT_VIDEO_GEN_DATA,
        },
      ],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    assert.equal(
      (
        await jsonRequest(
          `/api/projects/${first.id}/graph`,
          { graph, expectedVersion: initial.version },
          "PUT",
        )
      ).status,
      200,
    );
    for (const kind of ["image", "video"] as const) {
      const request = {
        kind,
        nodeId: kind,
        requestId: `job-${kind}`,
        input: {
          ...(kind === "image" ? DEFAULT_IMAGE_GEN_DATA : DEFAULT_VIDEO_GEN_DATA),
          prompt: "测试",
          imageList: [],
          videoList: [],
          audioList: [],
        },
      };
      const path = `/api/generation-jobs/${first.id}/jobs`;
      const response = await jsonRequest(path, request);
      assert.equal(response.status, 202, await response.clone().text());
      const job = z.object({ id: z.string() }).parse(await response.json());
      const recovered = await app.request(
        `/api/generation-jobs/${first.id}/requests/${request.requestId}`,
      );
      assert.equal(
        z.object({ job: z.object({ id: z.string() }) }).parse(await recovered.json()).job.id,
        job.id,
      );
      assert.deepEqual(
        await (
          await app.request(`/api/generation-jobs/${second.id}/requests/${request.requestId}`)
        ).json(),
        { job: null },
      );
      const duplicate = await jsonRequest(path, request);
      assert.equal(duplicate.status, 202);
      assert.equal(z.object({ id: z.string() }).parse(await duplicate.json()).id, job.id);
      let result: { status: string; resultUrl: string | null } | undefined;
      for (let i = 0; i < 50; i++) {
        result = z
          .object({ status: z.string(), resultUrl: z.string().nullable() })
          .parse(await (await app.request(`${path}/${job.id}`)).json());
        if (result.status !== "running") break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.equal(result?.status, "succeeded");
      assert.match(result?.resultUrl ?? "", kind === "image" ? /png$/ : /mp4$/);
    }
    assert.equal(generated, 2);
    const cancelledRun = await startChat("slow");
    await app.request(`/api/pi/projects/${first.id}/runs/${cancelledRun}/cancel`, {
      method: "POST",
    });
    const blocked = await jsonRequest(`/api/generation-jobs/${first.id}/jobs`, {
      kind: "image",
      nodeId: "image",
      requestId: "after-stop",
      runId: cancelledRun,
      input: { ...DEFAULT_IMAGE_GEN_DATA, prompt: "must not submit", imageList: [] },
    });
    assert.equal(blocked.status, 400);
    assert.equal(generated, 2);
  });

  await t.test("new conversations persist independently and cannot cross projects", async () => {
    const old = (await (await app.request(chatPath)).json()) as { conversationId: string };
    const created = await app.request(`/api/pi/projects/${first.id}/conversations`, {
      method: "POST",
    });
    assert.equal(created.status, 201);
    const { id: conversationId } = (await created.json()) as { id: string };
    const empty = historySchema.parse(
      await (await app.request(`${chatPath}?conversationId=${conversationId}`)).json(),
    );
    assert.deepEqual(empty.messages, []);
    assert.equal(empty.run, null);
    assert.equal(
      (await app.request(`/api/pi/projects/${second.id}/messages?conversationId=${conversationId}`))
        .status,
      400,
    );
    const sent = await jsonRequest(chatPath, {
      message: "fresh conversation",
      conversationId,
      clientId,
      requestId: crypto.randomUUID(),
    });
    const { runId } = (await sent.json()) as { runId: string };
    await collect(readPiStream(await eventsFor(runId)));
    const body = received.at(-1)?.body;
    assert.ok(!JSON.stringify(body?.messages).includes("tool-loop"));
    const { sdk } = await getPiRuntime();
    const reopened = sdk.SessionManager.continueRecent(
      join(directory, "pi/workspace", String(first.id)),
      join(directory, "pi/sessions", String(first.id), conversationId),
    );
    assert.deepEqual(
      chatMessages({ sessionManager: reopened }).map((message) => message.text),
      ["fresh conversation", "你好，Pi 已连接。"],
    );
    const previous = historySchema.parse(
      await (await app.request(`${chatPath}?conversationId=${old.conversationId}`)).json(),
    );
    assert.ok(previous.messages.some((message) => message.text === "hello"));
    const listing = (await (
      await app.request(`/api/pi/projects/${first.id}/conversations`)
    ).json()) as { conversations: { id: string; title: string }[] };
    assert.equal(
      listing.conversations.find((item) => item.id === conversationId)?.title,
      "fresh conversation",
    );
  });

  await t.test(
    "sends selected image pixels, persists attachments, and rejects non-images",
    async (t) => {
      const graphPath = `/api/projects/${first.id}/graph`;
      const { graph, version } = (await (await app.request(graphPath)).json()) as {
        graph: { nodes: unknown[] };
        version: number;
      };
      const imageUrl = "https://test.bcebos.com/test.png";
      graph.nodes.push(
        ...["photo-a", "photo-b"].map((id) => ({
          id,
          type: "media",
          position: { x: 0, y: 0 },
          data: { label: id, kind: "image", status: "ready", url: imageUrl },
        })),
      );
      assert.equal(
        (await jsonRequest(graphPath, { graph, expectedVersion: version }, "PUT")).status,
        200,
      );
      const request = {
        message: "compare photos",
        clientId,
        requestId: crypto.randomUUID(),
        imageNodeIds: ["photo-a", "photo-b"],
      };
      assert.equal((await jsonRequest(chatPath, request)).status, 400);
      await jsonRequest(
        "/api/pi/configuration",
        { ...connection, custom: { ...connection.custom, input: ["text", "image"] } },
        "PUT",
      );
      const originalFetch = globalThis.fetch;
      const png =
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==";
      t.mock.method(
        globalThis,
        "fetch",
        (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
          String(input) === imageUrl
            ? Promise.resolve(
                new Response(Buffer.from(png, "base64"), {
                  headers: { "content-type": "image/png" },
                }),
              )
            : originalFetch(input, init),
      );
      const sent = await jsonRequest(chatPath, request);
      assert.equal(sent.status, 202, await sent.clone().text());
      const { runId } = (await sent.json()) as { runId: string };
      await collect(readPiStream(await eventsFor(runId)));
      const body = received.at(-1)?.body as {
        messages: { role: string; content: { type: string; image_url?: { url: string } }[] }[];
      };
      const content = body.messages.findLast((message) => message.role === "user")?.content;
      const afterImages = historySchema.parse(await (await app.request(chatPath)).json());
      assert.equal(afterImages.run?.status, "completed", afterImages.run?.error ?? "");
      assert.equal(
        content?.filter((part) => part.type === "image_url").length,
        2,
        JSON.stringify(content),
      );
      assert.ok(content?.some((part) => part.image_url?.url === `data:image/png;base64,${png}`));
      const history = historySchema.parse(await (await app.request(chatPath)).json());
      assert.deepEqual(
        history.messages.at(-2)?.attachments.map((item) => item.nodeId),
        ["photo-a", "photo-b"],
      );
      assert.equal(history.messages.at(-2)?.text, "compare photos");
      for (const nodeId of ["video", "missing"]) {
        assert.equal(
          (
            await jsonRequest(chatPath, {
              ...request,
              requestId: crypto.randomUUID(),
              imageNodeIds: [nodeId],
            })
          ).status,
          400,
        );
      }
    },
  );
  await t.test(
    "concurrent retries share one run and an immediately cancelled prompt remains in history",
    async () => {
      const request = { message: "slow", clientId, requestId: crypto.randomUUID() };
      const responses = await Promise.all([
        jsonRequest(chatPath, request),
        jsonRequest(chatPath, request),
      ]);
      assert.deepEqual(
        responses.map((response) => response.status),
        [202, 202],
      );
      const runs = (await Promise.all(responses.map((response) => response.json()))) as {
        runId: string;
      }[];
      const runId = runs[0]?.runId;
      assert.equal(runId, runs[1]?.runId);
      await app.request(`/api/pi/projects/${first.id}/runs/${runId}/cancel`, { method: "POST" });
      await (await getProjectSession(first.id)).waitForIdle();
      const history = historySchema.parse(await (await app.request(chatPath)).json());
      const turn = history.messages.filter((message) => message.runId === runId);
      assert.equal(turn.filter((message) => message.role === "user").length, 1);
      assert.equal(turn[0]?.text, "slow");
      assert.ok(turn.find((message) => message.role === "assistant")?.error);
      assert.equal((await jsonRequest(chatPath, { ...request, message: "changed" })).status, 400);
    },
  );
  await t.test(
    "session info exposes supported thinking levels and persists the selected effort",
    async () => {
      const path = `/api/pi/projects/${first.id}/session-info`;
      const before = (await (await app.request(path)).json()) as { thinkingLevels: string[] };
      assert.deepEqual(before.thinkingLevels, []);
      assert.equal(
        (
          await jsonRequest(chatPath, {
            message: "hello",
            clientId,
            requestId: crypto.randomUUID(),
            thinkingLevel: "high",
          })
        ).status,
        400,
      );
      await jsonRequest(
        "/api/pi/configuration",
        {
          ...connection,
          custom: { ...connection.custom, reasoning: true, input: ["text", "image"] },
        },
        "PUT",
      );
      const supported = (await (await app.request(path)).json()) as {
        model: { id: string };
        thinkingLevels: string[];
      };
      assert.equal(supported.model.id, "test-model");
      assert.ok(supported.thinkingLevels.includes("high"));
      const response = await jsonRequest(chatPath, {
        message: "hello reasoning",
        clientId,
        requestId: crypto.randomUUID(),
        thinkingLevel: "high",
      });
      assert.equal(response.status, 202);
      const { runId } = (await response.json()) as { runId: string };
      await collect(readPiStream(await eventsFor(runId)));
      assert.equal(received.at(-1)?.body.reasoning_effort, "high");
      const info = (await (await app.request(path)).json()) as {
        thinkingLevel: string;
        context: { tokens: number; contextWindow: number };
      };
      assert.equal(info.thinkingLevel, "high");
      assert.ok(info.context.tokens > 0);
      assert.equal(info.context.contextWindow, 32768);
      const session = await getProjectSession(first.id);
      const { sdk } = await getPiRuntime();
      const file = session.sessionManager.getSessionFile();
      assert.ok(file);
      assert.equal(sdk.SessionManager.open(file).buildSessionContext().thinkingLevel, "high");
    },
  );
  await t.test(
    "installed skills refresh existing sessions, load references and expand explicit commands",
    async () => {
      const bytes = skillZip([
        {
          name: "guide/SKILL.md",
          content: `${skillManifest("integration-guide")}\nONLY_IN_FULL_SKILL_TEXT\n`,
        },
        { name: "guide/references/checklist.md", content: "REFERENCE_CHECKLIST_CONTENT" },
      ]);
      const form = new FormData();
      form.set("file", new File([new Uint8Array(bytes)], "guide.skill"));
      const previewResponse = await app.request("/api/pi/skills/preview", {
        method: "POST",
        body: form,
      });
      const preview = (await previewResponse.json()) as { id: string; skills: { id: string }[] };
      assert.equal(
        (
          await jsonRequest("/api/pi/skills/install", {
            previewId: preview.id,
            skillId: preview.skills[0]?.id,
          })
        ).status,
        201,
      );
      const before = received.length;
      const runId = await startChat("use-installed-skill");
      await collect(readPiStream(await eventsFor(runId)));
      const completed = historySchema.parse(await (await app.request(chatPath)).json());
      assert.equal(completed.run?.status, "completed", completed.run?.error ?? "");
      const firstRequest = JSON.stringify(received[before]?.body);
      assert.ok(
        firstRequest.includes("integration-guide"),
        "installed skill missing from model request",
      );
      assert.ok(!firstRequest.includes("ONLY_IN_FULL_SKILL_TEXT"));
      const finalRequest = received.at(-1)?.body as {
        messages: { role: string; content: unknown }[];
      };
      assert.ok(
        JSON.stringify(finalRequest).includes("REFERENCE_CHECKLIST_CONTENT"),
        JSON.stringify(
          finalRequest.messages
            .filter((message) => message.role === "tool")
            .map((message) => message.content),
        ),
      );
      const session = await getProjectSession(first.id);
      assert.ok(session.getActiveToolNames().includes("read_skill"));
      for (const tool of ["bash", "read", "write", "edit"])
        assert.ok(!session.getActiveToolNames().includes(tool));
      const history = historySchema.parse(await (await app.request(chatPath)).json());
      assert.deepEqual(history.messages.at(-1)?.skillReads, [
        { name: "integration-guide", file: "SKILL.md" },
        { name: "integration-guide", file: "references/checklist.md" },
      ]);
      const explicit = await startChat("/skill:integration-guide explain the steps");
      await collect(readPiStream(await eventsFor(explicit)));
      const request = received.at(-1)?.body as { messages: { role: string; content: unknown }[] };
      const user = JSON.stringify(
        request.messages.findLast((message) => message.role === "user")?.content,
      );
      assert.ok(user.includes("ONLY_IN_FULL_SKILL_TEXT") && user.includes("explain the steps"));
      const commandOnly = await jsonRequest(chatPath, {
        message: "/skill:integration-guide",
        clientId,
        requestId: crypto.randomUUID(),
        selectedNodeIds: ["selected-node"],
      });
      assert.equal(commandOnly.status, 202);
      const commandRun = (await commandOnly.json()) as { runId: string };
      await collect(readPiStream(await eventsFor(commandRun.runId)));
      const commandRequest = received.at(-1)?.body as {
        messages: { role: string; content: unknown }[];
      };
      const commandUser = JSON.stringify(
        commandRequest.messages.findLast((message) => message.role === "user")?.content,
      );
      assert.ok(
        commandUser.includes("ONLY_IN_FULL_SKILL_TEXT") && commandUser.includes("selected-node"),
      );
      assert.equal(
        (await jsonRequest("/api/pi/skills/integration-guide", { enabled: false }, "PATCH")).status,
        200,
      );
      assert.equal(
        (
          await jsonRequest(chatPath, {
            message: "/skill:integration-guide",
            clientId,
            requestId: crypto.randomUUID(),
          })
        ).status,
        400,
      );
      await collect(readPiStream(await eventsFor(await startChat("after disabling skill"))));
      assert.equal(session.resourceLoader.getSkills().skills.length, 0);
    },
  );
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
