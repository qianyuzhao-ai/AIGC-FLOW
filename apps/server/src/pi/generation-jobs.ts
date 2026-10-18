import { randomUUID } from "node:crypto";
import {
  clampImageConfig,
  clampVideoConfig,
  type GenerationJobRequest,
  generationJobViewSchema,
  IMAGE_GEN_NODE_TYPE,
  projectGraphSchema,
  VIDEO_GEN_NODE_TYPE,
} from "@aigc-flow/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { generationJobs, projects } from "../db/schema";
import { generateImage, generateVideo } from "../lib/generation-service";
import { getRun } from "./bridge";
import { recoverInterruptedWork } from "./recovery";
export function getJob(projectId: number, id: string) {
  recoverInterruptedWork();
  const row = db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.id, id)))
    .get();
  return row ? generationJobViewSchema.parse({ ...row, input: JSON.parse(row.input) }) : null;
}
export function startJob(projectId: number, request: GenerationJobRequest) {
  recoverInterruptedWork();
  if (request.kind === "image") {
    const { projectId: _id, ...input } = clampImageConfig({ ...request.input, projectId });
    request = { ...request, input };
  } else {
    const { projectId: _id, ...input } = clampVideoConfig({ ...request.input, projectId });
    request = { ...request, input };
  }
  const encoded = JSON.stringify(request.input);
  const existing = db
    .select()
    .from(generationJobs)
    .where(
      and(eq(generationJobs.projectId, projectId), eq(generationJobs.requestId, request.requestId)),
    )
    .get();
  if (existing) {
    if (
      existing.nodeId !== request.nodeId ||
      existing.kind !== request.kind ||
      existing.input !== encoded
    )
      throw new Error("相同请求 ID 不能重新生成不同内容");
    return getJob(projectId, existing.id);
  }
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (request.runId) {
    const run = getRun(request.runId);
    if (run?.projectId !== projectId || run.status !== "running")
      throw new Error("Agent 已停止，未提交新的生成请求");
  }
  if (!project) throw new Error("项目不存在");
  const graph = projectGraphSchema.parse(JSON.parse(project.graph));
  const node = graph.nodes.find((item) => item.id === request.nodeId);
  if (!node || node.type !== (request.kind === "image" ? IMAGE_GEN_NODE_TYPE : VIDEO_GEN_NODE_TYPE))
    throw new Error("生成节点尚未保存或类型不匹配");
  if (
    db
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.projectId, projectId),
          eq(generationJobs.nodeId, request.nodeId),
          eq(generationJobs.status, "running"),
        ),
      )
      .get()
  )
    throw new Error("这个节点已有生成任务");
  const id = randomUUID();
  db.insert(generationJobs)
    .values({
      id,
      projectId,
      requestId: request.requestId,
      nodeId: request.nodeId,
      kind: request.kind,
      input: encoded,
      status: "running",
    })
    .run();
  void (async () => {
    try {
      const outcome =
        request.kind === "image"
          ? await generateImage({ ...request.input, projectId })
          : await generateVideo({ ...request.input, projectId });
      db.update(generationJobs)
        .set(
          "url" in outcome
            ? { status: "succeeded", resultUrl: outcome.url }
            : {
                status: "unknown" in outcome && outcome.unknown ? "unknown" : "failed",
                error: outcome.message,
              },
        )
        .where(eq(generationJobs.id, id))
        .run();
    } catch (error) {
      db.update(generationJobs)
        .set({ status: "unknown", error: error instanceof Error ? error.message : "生成结果未知" })
        .where(eq(generationJobs.id, id))
        .run();
    }
  })();
  return getJob(projectId, id);
}
export function findJobByRequest(projectId: number, requestId: string) {
  recoverInterruptedWork();
  const row = db
    .select()
    .from(generationJobs)
    .where(and(eq(generationJobs.projectId, projectId), eq(generationJobs.requestId, requestId)))
    .get();
  return row ? generationJobViewSchema.parse({ ...row, input: JSON.parse(row.input) }) : null;
}
