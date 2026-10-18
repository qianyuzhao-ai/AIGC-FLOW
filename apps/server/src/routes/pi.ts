import {
  type PiChatEvent,
  piConnectionSchema,
  piModelsRequestSchema,
  piPromptSchema,
} from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db";
import { projects } from "../db/schema";
import { getConfiguredModel, getPiConfiguration, savePiConfiguration } from "../pi/configuration";
import { discoverPiModels } from "../pi/model-discovery";
import { getPiRuntime } from "../pi/runtime";
import { chatMessages, getProjectSession } from "../pi/sessions";

const projectParam = z.object({ projectId: z.coerce.number().int().positive() });
const running = new Set<number>();
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Pi 请求失败");

export const piRoute = new Hono()
  .onError((error, c) => c.json({ message: errorMessage(error) }, 400))
  .get("/configuration", async (c) => c.json(await getPiConfiguration()))
  .put("/configuration", zValidator("json", piConnectionSchema), async (c) =>
    c.json(await savePiConfiguration(c.req.valid("json"))),
  )
  .post("/models", zValidator("json", piModelsRequestSchema), async (c) =>
    c.json({ models: await discoverPiModels(c.req.valid("json"), c.req.raw.signal) }),
  )
  .post("/verify", async (c) => {
    const { models } = await getPiRuntime();
    const model = await getConfiguredModel();
    const reply = await models.completeSimple(
      model,
      {
        messages: [{ role: "user", content: "只回复 OK", timestamp: Date.now() }],
      },
      { maxTokens: 128, signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(120_000)]) },
    );
    if (reply.stopReason === "error" || reply.stopReason === "aborted") {
      return c.json({ message: reply.errorMessage ?? "模型请求失败" }, 502);
    }
    return c.json({
      reply: reply.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join(""),
      model: model.id,
    });
  })
  .use("/projects/:projectId/*", async (c, next) => {
    const id = Number(c.req.param("projectId"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ message: "项目不存在" }, 404);
    if (!db.select({ id: projects.id }).from(projects).where(eq(projects.id, id)).get()) {
      return c.json({ message: "项目不存在" }, 404);
    }
    await next();
  })
  .get("/projects/:projectId/messages", zValidator("param", projectParam), async (c) => {
    const { projectId } = c.req.valid("param");
    return c.json({
      messages: chatMessages(await getProjectSession(projectId)),
      running: running.has(projectId),
    });
  })
  .post("/projects/:projectId/abort", zValidator("param", projectParam), async (c) => {
    await (await getProjectSession(c.req.valid("param").projectId)).abort();
    return c.json({ stopped: true });
  })
  .post(
    "/projects/:projectId/messages",
    zValidator("param", projectParam),
    zValidator("json", piPromptSchema),
    async (c) => {
      const { projectId } = c.req.valid("param");
      if (running.has(projectId))
        return c.json({ message: "当前对话正在生成，请先停止或等待完成" }, 409);
      running.add(projectId);
      try {
        const session = await getProjectSession(projectId);
        await session.setModel(await getConfiguredModel());
        const { message } = c.req.valid("json");
        return streamSSE(c, async (stream) => {
          const send = (event: PiChatEvent) => stream.writeSSE({ data: JSON.stringify(event) });
          stream.onAbort(() => session.abort());
          let writing = Promise.resolve();
          let streamError: unknown;
          const publish = (event: PiChatEvent) => {
            writing = writing
              .then(async () => {
                if (!streamError) await send(event);
              })
              .catch(async (error: unknown) => {
                streamError = error;
                await session.abort();
              });
          };
          const unsubscribe = session.subscribe((event) => {
            if (
              event.type === "message_update" &&
              event.assistantMessageEvent.type === "text_delta"
            ) {
              publish({ type: "text", delta: event.assistantMessageEvent.delta });
            }
            if (
              event.type === "message_end" &&
              event.message.role === "assistant" &&
              event.message.stopReason === "error"
            ) {
              publish({ type: "error", message: event.message.errorMessage ?? "模型请求失败" });
            }
          });
          try {
            await session.prompt(message);
            await writing;
            if (streamError) throw streamError;
            await send({ type: "done", messages: chatMessages(session) });
          } catch (error) {
            if (!stream.aborted) await send({ type: "error", message: errorMessage(error) });
          } finally {
            unsubscribe();
            running.delete(projectId);
          }
        });
      } catch (error) {
        running.delete(projectId);
        throw error;
      }
    },
  );
