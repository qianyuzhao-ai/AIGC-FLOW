import { EMPTY_GRAPH_JSON } from "@aigc-flow/shared";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * 时间戳统一存 ISO 8601 UTC（带 Z）。
 * 不能用 CURRENT_TIMESTAMP —— 它产出 "2026-08-30 03:16:28" 这种无时区标记的格式，
 * JS 的 new Date() 会按本地时区解析，导致前端显示的时间整体偏移。
 */
const isoNow = sql`(strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`;

/** 项目：一条记录对应一张节点画布 */
export const projects = sqliteTable("projects", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /** 封面图路径，当前版本恒为 null，前端按名称生成占位图 */
  coverImage: text("cover_image"),
  /** 整张画布图（nodes / edges / viewport）的 JSON，读写都是整体覆盖 */
  graph: text("graph").notNull().default(EMPTY_GRAPH_JSON),
  graphVersion: integer("graph_version").notNull().default(0),
  createdAt: text("created_at").notNull().default(isoNow),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;

/** 内网服务设置，KV 结构；Pi 模型与凭据使用独立配置文件。 */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull().default(isoNow),
});

export type SettingRow = typeof settings.$inferSelect;

/**
 * 生成请求流水，成本核算用。每次转发内网 /aigc 都记一条，成功失败都记。
 * 按项目（画布）归属，统计面板按当前项目过滤。
 */
export const generations = sqliteTable(
  "generations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * 所属项目。加这一列之前的老记录是 null；项目删除后置 null 而不是级联删 ——
     * 花出去的钱不因为画布删了就不算了，全局口径（不带 projectId 查）仍能看到。
     */
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    /** image | video */
    kind: text("kind").notNull(),
    /** 发给内网接口的完整请求体 JSON（req_from 也在里面，核对来源用） */
    payload: text("payload").notNull(),
    /** success | error */
    status: text("status").notNull(),
    /** 失败原因，成功为 null */
    error: text("error"),
    /** 生成结果地址，失败为 null */
    resultUrl: text("result_url"),
    /** 视频请求的时长（秒），-1 表示自动；图像为 null */
    durationSeconds: integer("duration_seconds"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("generations_project_id_idx").on(table.projectId)],
);

export type GenerationRow = typeof generations.$inferSelect;

export const agentRuns = sqliteTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    projectId: integer("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    clientId: text("client_id").notNull(),
    input: text("input").notNull().default("{}"),
    status: text("status").notNull(),
    error: text("error"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("agent_runs_project_idx").on(table.projectId),
    uniqueIndex("agent_runs_request_idx").on(table.projectId, table.requestId),
    uniqueIndex("agent_runs_active_idx")
      .on(table.projectId)
      .where(sql`${table.status} = 'running'`),
  ],
);

export const agentCommands = sqliteTable(
  "agent_commands",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    args: text("args").notNull(),
    expectedRevision: integer("expected_revision"),
    status: text("status").notNull(),
    result: text("result"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [index("agent_commands_run_idx").on(table.runId)],
);

export const generationJobs = sqliteTable(
  "generation_jobs",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    projectId: integer("project_id").references(() => projects.id, { onDelete: "set null" }),
    nodeId: text("node_id").notNull(),
    kind: text("kind").notNull(),
    input: text("input").notNull(),
    status: text("status").notNull(),
    resultUrl: text("result_url"),
    error: text("error"),
    createdAt: text("created_at").notNull().default(isoNow),
  },
  (table) => [
    index("generation_jobs_project_idx").on(table.projectId),
    uniqueIndex("generation_jobs_request_idx").on(table.projectId, table.requestId),
    uniqueIndex("generation_jobs_active_idx")
      .on(table.projectId, table.nodeId)
      .where(sql`${table.status} = 'running'`),
  ],
);
