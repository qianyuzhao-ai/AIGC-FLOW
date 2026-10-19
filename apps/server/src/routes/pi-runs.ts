import { commandResultSchema, startAgentRunSchema } from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { db } from "../db";
import { projects } from "../db/schema";
import {
  commandViews,
  getRun,
  receiveProgress,
  receiveResult,
  runView,
  stopRun,
  subscribeRun,
} from "../pi/bridge";
import { createConversation, getConversation, listConversations } from "../pi/conversations";
import { latestRun, snapshotRun, startRun } from "../pi/runs";
import { readProjectMessages } from "../pi/sessions";

const project = z.object({ projectId: z.coerce.number().int().positive() });
const runParams = project.extend({ runId: z.string().min(1) });
const commandParams = runParams.extend({ commandId: z.string().min(1) });
export const piRunsRoute = new Hono()
  .onError((error, c) => c.json({ message: error.message }, 400))
  .use("/:projectId/*", async (c, next) => {
    const id = Number(c.req.param("projectId"));
    if (!Number.isInteger(id) || !db.select().from(projects).where(eq(projects.id, id)).get())
      return c.json({ message: "项目不存在" }, 404);
    const runId = c.req.param("runId");
    if (runId && getRun(runId)?.projectId !== id)
      return c.json({ message: "运行不属于此项目" }, 404);
    await next();
  })
  .use("/:projectId/runs/:runId/*", async (c, next) => {
    if (getRun(c.req.param("runId") ?? "")?.projectId !== Number(c.req.param("projectId")))
      return c.json({ message: "运行不属于此项目" }, 404);
    await next();
  })
  .get("/:projectId/conversations", zValidator("param", project), (c) =>
    c.json({ conversations: listConversations(c.req.valid("param").projectId) }),
  )
  .post("/:projectId/conversations", zValidator("param", project), (c) => {
    const { projectId } = c.req.valid("param");
    if (latestRun(projectId)?.status === "running")
      return c.json({ message: "请先停止当前任务" }, 409);
    return c.json(createConversation(projectId), 201);
  })
  .get(
    "/:projectId/messages",
    zValidator("param", project),
    zValidator("query", z.object({ conversationId: z.string().min(1).optional() })),
    async (c) => {
      const { projectId } = c.req.valid("param");
      const conversation = getConversation(projectId, c.req.valid("query").conversationId);
      const run = latestRun(projectId, conversation.id);
      return c.json({
        conversationId: conversation.id,
        conversations: listConversations(projectId),
        messages: await readProjectMessages(projectId, conversation.id),
        run: run ? runView(run.id) : null,
        commands: run ? commandViews(run.id) : [],
      });
    },
  )
  .post(
    "/:projectId/messages",
    zValidator("param", project),
    zValidator("json", startAgentRunSchema),
    async (c) => {
      const id = await startRun(
        c.req.valid("param").projectId,
        c.req.valid("json"),
        c.req.raw.signal,
      );
      const run = getRun(id);
      if (!run?.conversationId) throw new Error("运行没有关联对话");
      return c.json({ runId: id, conversationId: run.conversationId }, 202);
    },
  )
  .get(
    "/:projectId/runs/:runId/events",
    zValidator("param", runParams),
    zValidator("query", z.object({ clientId: z.string().min(1) })),
    async (c) => {
      const { runId } = c.req.valid("param");
      return streamSSE(c, async (stream) => {
        let dirty = true;
        let textDirty = false;
        let wake: (() => void) | undefined;
        const unsubscribe = subscribeRun(runId, c.req.valid("query").clientId, (textOnly) => {
          if (textOnly) textDirty = true;
          else dirty = true;
          wake?.();
        });
        stream.onAbort(() => wake?.());
        try {
          while (!stream.aborted) {
            if (dirty) {
              dirty = false;
              await stream.writeSSE({
                data: JSON.stringify({ type: "state", ...(await snapshotRun(runId)) }),
              });
              if (getRun(runId)?.status !== "running") break;
            }
            if (textDirty && !stream.aborted) {
              textDirty = false;
              await stream.writeSSE({
                data: JSON.stringify({ type: "partial", text: runView(runId)?.partial ?? "" }),
              });
            }
            await new Promise<void>((resolve) => {
              const timeout = setTimeout(() => {
                wake = undefined;
                resolve();
              }, 15000);
              wake = () => {
                clearTimeout(timeout);
                wake = undefined;
                resolve();
              };
              if (dirty || textDirty || stream.aborted) wake();
            });
            if (!dirty && !textDirty && !stream.aborted)
              await stream.writeSSE({ event: "heartbeat", data: "{}" });
          }
        } finally {
          unsubscribe();
        }
      });
    },
  )
  .post("/:projectId/runs/:runId/cancel", zValidator("param", runParams), (c) => {
    stopRun(c.req.valid("param").runId);
    return c.json({ stopped: true });
  })
  .post(
    "/:projectId/runs/:runId/commands/:commandId/result",
    zValidator("param", commandParams),
    zValidator("json", commandResultSchema),
    (c) => {
      const { runId, commandId } = c.req.valid("param");
      const { clientId, result } = c.req.valid("json");
      receiveResult(runId, commandId, clientId, result);
      return c.json({ received: true });
    },
  )
  .post(
    "/:projectId/runs/:runId/commands/:commandId/progress",
    zValidator("param", commandParams),
    zValidator("json", z.object({ clientId: z.string(), message: z.string().max(1000) })),
    (c) => {
      const { runId, commandId } = c.req.valid("param");
      const { clientId, message } = c.req.valid("json");
      receiveProgress(runId, commandId, clientId, message);
      return c.json({ received: true });
    },
  );
