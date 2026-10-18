import { randomUUID } from "node:crypto";
import {
  agentCommandViewSchema,
  agentRunViewSchema,
  type CanvasCommand,
  type CanvasReceipt,
  type CanvasToolName,
  canvasReceiptSchema,
} from "@aigc-flow/shared";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentCommands, agentRuns } from "../db/schema";

type Waiting = {
  resolve: (value: CanvasReceipt) => void;
  reject: (error: Error) => void;
  progress?: (text: string) => void;
};
export type LiveRun = {
  id: string;
  projectId: number;
  clientId: string;
  partial: string;
  revision: number | null;
  listeners: Set<(textOnly?: boolean) => void>;
  waiting: Map<string, Waiting>;
  progress: Map<string, string>;
  abort?: () => Promise<void>;
  disconnected?: ReturnType<typeof setTimeout>;
  owners: number;
};
const live = new Map<string, LiveRun>();
export function findLiveRun(id: string) {
  return live.get(id);
}
export function getRun(id: string) {
  return db.select().from(agentRuns).where(eq(agentRuns.id, id)).get();
}
export function runView(id: string) {
  const row = getRun(id);
  return row ? agentRunViewSchema.parse({ ...row, partial: live.get(id)?.partial ?? "" }) : null;
}
export function commandViews(id: string) {
  return db
    .select()
    .from(agentCommands)
    .where(eq(agentCommands.runId, id))
    .orderBy(asc(sql`rowid`))
    .all()
    .map((row) =>
      agentCommandViewSchema.parse({
        ...row,
        args: JSON.parse(row.args),
        result: row.result ? JSON.parse(row.result) : null,
        progress: live.get(id)?.progress.get(row.id),
      }),
    );
}
export function notifyRun(id: string, textOnly = false) {
  for (const listener of live.get(id)?.listeners ?? []) listener(textOnly);
}
export function beginLiveRun(id: string, projectId: number, clientId: string) {
  const run: LiveRun = {
    id,
    projectId,
    clientId,
    partial: "",
    revision: null,
    listeners: new Set(),
    waiting: new Map(),
    progress: new Map(),
    owners: 0,
  };
  live.set(id, run);
  disconnectRun(run);
  return run;
}
function disconnectRun(run: LiveRun) {
  if (run.disconnected) clearTimeout(run.disconnected);
  run.disconnected = setTimeout(
    () => stopRun(run.id, "画布执行器离线超过 120 秒，任务已停止"),
    120_000,
  );
  run.disconnected.unref();
}
export function subscribeRun(id: string, clientId: string, listener: (textOnly?: boolean) => void) {
  const run = live.get(id);
  if (!run) return () => {};
  run.listeners.add(listener);
  if (run.clientId === clientId) {
    run.owners++;
    clearTimeout(run.disconnected);
  }
  return () => {
    run.listeners.delete(listener);
    if (run.clientId === clientId && --run.owners === 0 && getRun(id)?.status === "running")
      disconnectRun(run);
  };
}
export function finishRun(id: string, status: "completed" | "failed", error?: string) {
  const row = getRun(id);
  if (row?.status === "running")
    db.update(agentRuns)
      .set({ status, error: error ?? null })
      .where(eq(agentRuns.id, id))
      .run();
  const run = live.get(id);
  clearTimeout(run?.disconnected);
  notifyRun(id);
}
export function stopRun(id: string, error?: string) {
  const run = live.get(id);
  if (getRun(id)?.status !== "running") return;
  db.update(agentRuns)
    .set({
      status: error ? "failed" : "cancelled",
      error: error ?? "已停止后续操作，已提交生成仍会返回结果",
    })
    .where(eq(agentRuns.id, id))
    .run();
  if (run) {
    clearTimeout(run.disconnected);
    for (const [commandId, pending] of run.waiting) {
      db.update(agentCommands)
        .set({ status: "cancelled" })
        .where(eq(agentCommands.id, commandId))
        .run();
      pending.reject(new Error(error ?? "用户停止任务"));
    }
    run.waiting.clear();
    void run.abort?.();
  }
  notifyRun(id);
}
export function dispatchCanvasTool(
  projectId: number,
  name: CanvasToolName,
  args: Record<string, unknown>,
  signal: AbortSignal | undefined,
  onProgress?: (text: string) => void,
) {
  const run = [...live.values()].find(
    (item) => item.projectId === projectId && getRun(item.id)?.status === "running",
  );
  if (!run || signal?.aborted) throw new Error("当前没有有效的运行");
  const command: CanvasCommand = {
    id: randomUUID(),
    runId: run.id,
    name,
    args,
    expectedRevision: run.revision,
  };
  db.insert(agentCommands)
    .values({ ...command, args: JSON.stringify(args), status: "pending" })
    .run();
  return new Promise<CanvasReceipt>((resolve, reject) => {
    const timeout =
      name === "generate_nodes"
        ? undefined
        : setTimeout(() => {
            stopRun(run.id, "画布命令未得到回执，执行结果未知；没有自动重放");
          }, 120_000);
    timeout?.unref();
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      run.waiting.delete(command.id);
    };
    const abort = () => {
      cleanup();
      reject(new Error("任务已停止"));
    };
    run.waiting.set(command.id, {
      resolve: (receipt) => {
        cleanup();
        resolve(receipt);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
      progress: onProgress,
    });
    signal?.addEventListener("abort", abort, { once: true });
    notifyRun(run.id);
  });
}
export function receiveResult(runId: string, commandId: string, clientId: string, input: unknown) {
  const run = getRun(runId);
  const command = db.select().from(agentCommands).where(eq(agentCommands.id, commandId)).get();
  if (!run || run.clientId !== clientId || command?.runId !== runId)
    throw new Error("回执不属于当前项目的执行客户端");
  const result = canvasReceiptSchema.parse(input);
  if (command.status !== "pending") {
    if (command.status === "cancelled" && !command.result)
      db.update(agentCommands)
        .set({ result: JSON.stringify(result) })
        .where(eq(agentCommands.id, commandId))
        .run();
    return;
  }
  db.update(agentCommands)
    .set({ status: result.success ? "completed" : "failed", result: JSON.stringify(result) })
    .where(eq(agentCommands.id, commandId))
    .run();
  const current = live.get(runId);
  current?.progress.delete(commandId);
  if (current) {
    current.revision =
      command.name === "generate_nodes" || !result.success ? null : result.revision;
    current.waiting.get(commandId)?.resolve(result);
  }
  if (result.applied && !result.saved) stopRun(runId, "画布已修改但保存失败，请先处理保存问题");
  notifyRun(runId);
}
export function receiveProgress(
  runId: string,
  commandId: string,
  clientId: string,
  message: string,
) {
  const run = live.get(runId);
  if (!run || run.clientId !== clientId || !run.waiting.has(commandId))
    throw new Error("无效的进度回执");
  run.progress.set(commandId, message);
  run.waiting.get(commandId)?.progress?.(message);
  notifyRun(runId);
}
