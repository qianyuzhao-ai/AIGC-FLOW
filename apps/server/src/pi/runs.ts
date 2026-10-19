import { randomUUID } from "node:crypto";
import type { startAgentRunSchema } from "@aigc-flow/shared";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db";
import { agentRuns } from "../db/schema";
import { beginLiveRun, commandViews, finishRun, getRun, notifyRun, runView } from "./bridge";
import { getConfiguredModel } from "./configuration";
import { getConversation, legacyConversationId, touchConversation } from "./conversations";
import { loadImages, selectedImages } from "./images";
import { recoverInterruptedWork } from "./recovery";
import { getProjectSession, readProjectMessages } from "./sessions";
export function latestRun(projectId: number, conversationId?: string) {
  recoverInterruptedWork();
  return db
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.projectId, projectId),
        conversationId
          ? or(
              eq(agentRuns.conversationId, conversationId),
              conversationId === legacyConversationId(projectId)
                ? isNull(agentRuns.conversationId)
                : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(sql`rowid`))
    .get();
}
export async function snapshotRun(id: string) {
  const run = getRun(id);
  if (!run) throw new Error("运行不存在");
  const messages = await readProjectMessages(
    run.projectId,
    run.conversationId ?? legacyConversationId(run.projectId),
  );
  return {
    run: runView(id),
    commands: commandViews(id),
    messages,
  };
}
export async function startRun(
  projectId: number,
  input: z.infer<typeof startAgentRunSchema>,
  signal?: AbortSignal,
) {
  recoverInterruptedWork();
  const conversation = getConversation(projectId, input.conversationId);
  const encoded = JSON.stringify({
    message: input.message,
    selectedNodeIds: input.selectedNodeIds,
    conversationId: conversation.id,
    imageNodeIds: input.imageNodeIds,
    thinkingLevel: input.thinkingLevel,
  });
  const existingRequest = () => {
    const existing = db
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.projectId, projectId), eq(agentRuns.requestId, input.requestId)))
      .get();
    if (existing && (existing.clientId !== input.clientId || existing.input !== encoded))
      throw new Error("同一请求 ID 的内容不能改变");
    return existing?.id;
  };
  const existing = existingRequest();
  if (existing) return existing;
  const attachments = input.imageNodeIds.length
    ? selectedImages(projectId, input.imageNodeIds)
    : [];
  const model = await getConfiguredModel();
  if (input.thinkingLevel) {
    const { getSupportedThinkingLevels } = await import("@earendil-works/pi-ai");
    if (!getSupportedThinkingLevels(model).includes(input.thinkingLevel))
      throw new Error("当前模型不支持这个思考等级，请刷新模型信息后重试");
  }
  if (attachments.length && !model.input.includes("image"))
    throw new Error("当前 Pi 模型未启用图片输入，请选择视觉模型，或在自定义模型设置中开启图片输入");
  const images = await loadImages(attachments, signal);
  signal?.throwIfAborted();
  const submittedWhileLoading = existingRequest();
  if (submittedWhileLoading) return submittedWhileLoading;
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
      conversationId: conversation.id,
      requestId: input.requestId,
      clientId: input.clientId,
      status: "running",
      input: encoded,
    })
    .run();
  touchConversation(conversation.id, input.message);
  const live = beginLiveRun(id, projectId, input.clientId);
  void (async () => {
    try {
      const session = await getProjectSession(projectId, conversation.id);
      await session.waitForIdle();
      if (getRun(id)?.status !== "running") return;
      live.abort = () => session.abort();
      await session.setModel(model);
      if (input.thinkingLevel) session.setThinkingLevel(input.thinkingLevel);
      if (getRun(id)?.status !== "running") return;
      session.sessionManager.appendCustomEntry("aigc-flow-turn", {
        runId: id,
        text: input.message,
        attachments,
      });
      let modelError: string | undefined;
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_start" && event.message.role === "assistant") live.partial = "";
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          live.partial += event.assistantMessageEvent.delta;
          notifyRun(id, true);
        }
        if (event.type === "message_end") {
          if (event.message.role === "assistant") live.partial = "";
          // Pi persists after notifying subscribers; read the branch once that append completes.
          queueMicrotask(() => notifyRun(id));
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
        const imageContext = attachments.length
          ? `\n\n[附图按顺序对应节点：${attachments.map((image) => image.nodeId).join(", ")}。仅这些附图可用于视觉分析。]`
          : "";
        await session.prompt(input.message + selection + imageContext, { images });
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
