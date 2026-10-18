import { randomUUID } from "node:crypto";
import type { startAgentRunSchema } from "@aigc-flow/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db";
import { agentRuns } from "../db/schema";
import { beginLiveRun, commandViews, finishRun, getRun, notifyRun, runView } from "./bridge";
import { getConfiguredModel } from "./configuration";
import { recoverInterruptedWork } from "./recovery";
import { getProjectSession, readProjectMessages } from "./sessions";
export function latestRun(projectId: number) {
  recoverInterruptedWork();
  return db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.projectId, projectId))
    .orderBy(desc(sql`rowid`))
    .get();
}
export async function snapshotRun(id: string) {
  const run = getRun(id);
  if (!run) throw new Error("运行不存在");
  return {
    run: runView(id),
    commands: commandViews(id),
    messages: await readProjectMessages(run.projectId),
  };
}
export function startRun(projectId: number, input: z.infer<typeof startAgentRunSchema>) {
  recoverInterruptedWork();
  const encoded = JSON.stringify({
    message: input.message,
    selectedNodeIds: input.selectedNodeIds,
  });
  const existing = db
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.requestId, input.requestId)))
    .get();
  if (existing) {
    if (existing.clientId !== input.clientId || existing.input !== encoded)
      throw new Error("同一请求 ID 的内容不能改变");
    return existing.id;
  }
  if (
    db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.status, "running")))
      .get()
  )
    throw new Error("当前项目已有任务正在运行");
  const id = randomUUID();
  db.insert(agentRuns)
    .values({
      id,
      projectId,
      requestId: input.requestId,
      clientId: input.clientId,
      status: "running",
      input: encoded,
    })
    .run();
  const live = beginLiveRun(id, projectId, input.clientId);
  void (async () => {
    try {
      const session = await getProjectSession(projectId);
      await session.waitForIdle();
      if (getRun(id)?.status !== "running") return;
      live.abort = () => session.abort();
      await session.setModel(await getConfiguredModel());
      let modelError: string | undefined;
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_start" && event.message.role === "assistant") live.partial = "";
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          live.partial += event.assistantMessageEvent.delta;
          notifyRun(id, true);
        }
        if (
          event.type === "message_end" &&
          event.message.role === "assistant" &&
          event.message.stopReason === "error"
        ) {
          modelError = event.message.errorMessage ?? "模型请求失败";
        }
      });
      try {
        const selection = input.selectedNodeIds.length
          ? `\n\n[发送时选中的节点 ID：${input.selectedNodeIds.join(", ")}]`
          : "";
        await session.prompt(input.message + selection);
        live.partial = "";
        finishRun(id, modelError ? "failed" : "completed", modelError);
      } finally {
        unsubscribe();
        notifyRun(id);
      }
    } catch (error) {
      finishRun(id, "failed", error instanceof Error ? error.message : "运行失败");
    }
  })();
  return id;
}
