import {
  createProjectSchema,
  EMPTY_GRAPH,
  projectGraphSchema,
  saveGraphSchema,
  updateProjectSchema,
} from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { agentRuns, generationJobs, generations, projects } from "../db/schema";

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

/** 项目的“元信息”列。graph 单独走 /:id/graph，不混在这些接口里 */
const projectColumns = {
  id: projects.id,
  name: projects.name,
  coverImage: projects.coverImage,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt,
};

/**
 * SQLite 不会自动维护 updated_at，update 时必须显式写。
 * 格式要和 schema.ts 里的 isoNow 一致（带 Z 的 ISO 8601 UTC）。
 */
function nowIso(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`;
}

export const projectsRoute = new Hono()
  .get("/", (c) => {
    // 最近更新的排在前面；同一秒内创建的多条用 id 兜底保证顺序稳定
    // 不含 graph：列表页用不上，整图 JSON 会白白撑大响应
    const rows = db
      .select(projectColumns)
      .from(projects)
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .all();
    return c.json(rows);
  })
  .post("/", zValidator("json", createProjectSchema), (c) => {
    const input = c.req.valid("json");
    const row = db.insert(projects).values({ name: input.name }).returning(projectColumns).get();
    return c.json(row, 201);
  })
  .get("/:id", zValidator("param", idParamSchema), (c) => {
    const { id } = c.req.valid("param");
    const row = db.select(projectColumns).from(projects).where(eq(projects.id, id)).get();
    if (!row) return c.json({ message: "项目不存在" }, 404);
    return c.json(row);
  })
  .patch(
    "/:id",
    zValidator("param", idParamSchema),
    zValidator("json", updateProjectSchema),
    (c) => {
      const { id } = c.req.valid("param");
      const { name } = c.req.valid("json");

      const row = db
        .update(projects)
        .set({ name, updatedAt: nowIso() })
        .where(eq(projects.id, id))
        .returning(projectColumns)
        .get();
      if (!row) return c.json({ message: "项目不存在" }, 404);

      return c.json(row);
    },
  )
  .delete("/:id", zValidator("param", idParamSchema), (c) => {
    const { id } = c.req.valid("param");
    if (
      db
        .select()
        .from(agentRuns)
        .where(and(eq(agentRuns.projectId, id), eq(agentRuns.status, "running")))
        .get() ||
      db
        .select()
        .from(generationJobs)
        .where(and(eq(generationJobs.projectId, id), eq(generationJobs.status, "running")))
        .get()
    ) {
      return c.json({ message: "项目仍有运行中的任务，请先停止 Agent 并等待已提交生成完成" }, 409);
    }
    // 生成流水不跟着项目删（花出去的钱要留底），先把归属置空再删项目。
    // 连接开着 foreign_keys，不先解开引用的话删除会被外键约束挡住。
    const row = db.transaction((tx) => {
      tx.update(generations).set({ projectId: null }).where(eq(generations.projectId, id)).run();
      return tx.delete(projects).where(eq(projects.id, id)).returning({ id: projects.id }).get();
    });
    if (!row) return c.json({ message: "项目不存在" }, 404);
    return c.json({ id: row.id });
  })
  .get("/:id/graph", zValidator("param", idParamSchema), (c) => {
    const { id } = c.req.valid("param");
    const row = db
      .select({ graph: projects.graph, version: projects.graphVersion })
      .from(projects)
      .where(eq(projects.id, id))
      .get();
    if (!row) return c.json({ message: "项目不存在" }, 404);

    // 落盘的是自由文本，脏数据不能让整个画布打不开：解析失败就退回空图
    const parsed = projectGraphSchema.safeParse(safeJsonParse(row.graph));
    if (!parsed.success) {
      console.warn(`[graph] 项目 ${id} 的图数据无法解析，已回退为空图`);
      return c.json({ graph: EMPTY_GRAPH, version: row.version });
    }
    return c.json({ graph: parsed.data, version: row.version });
  })
  .put(
    "/:id/graph",
    zValidator("param", idParamSchema),
    zValidator("json", saveGraphSchema),
    (c) => {
      const { id } = c.req.valid("param");
      const { graph, expectedVersion } = c.req.valid("json");

      const row = db
        .update(projects)
        .set({
          graph: JSON.stringify(graph),
          graphVersion: sql`${projects.graphVersion} + 1`,
          updatedAt: nowIso(),
        })
        .where(and(eq(projects.id, id), eq(projects.graphVersion, expectedVersion)))
        .returning({
          id: projects.id,
          updatedAt: projects.updatedAt,
          version: projects.graphVersion,
        })
        .get();
      if (!row) return c.json({ message: "画布已被其他窗口修改，刷新前请保留当前修改" }, 409);
      return c.json(row);
    },
  );

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
