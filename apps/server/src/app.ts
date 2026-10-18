import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { corsOrigins } from "./env";
import { generateRoute } from "./routes/generate";
import { generationJobsRoute } from "./routes/generation-jobs";
import { generationsRoute } from "./routes/generations";
import { healthRoute } from "./routes/health";
import { piRoute } from "./routes/pi";
import { projectsRoute } from "./routes/projects";
import { settingsRoute } from "./routes/settings";
import { uploadsRoute } from "./routes/uploads";

/**
 * 路由必须链式挂载，Hono RPC 的类型推导依赖这条链。
 * 拆成 `app.route(...)` 多条语句会让 AppType 退化成空类型。
 */
const app = new Hono()
  .use("*", logger())
  .use("/api/*", cors({ origin: corsOrigins, credentials: true }))
  .route("/api/health", healthRoute)
  .route("/api/projects", projectsRoute)
  .route("/api/settings", settingsRoute)
  .route("/api/pi", piRoute)
  .route("/api/uploads", uploadsRoute)
  .route("/api/generate", generateRoute)
  .route("/api/generation-jobs", generationJobsRoute)
  .route("/api/generations", generationsRoute);

app.onError((err, c) => {
  console.error("[server error]", err);
  return c.json({ message: "服务器内部错误" }, 500);
});

app.notFound((c) => c.json({ message: "接口不存在" }, 404));

/** 供 apps/client 通过 Hono RPC 复用的接口类型 */
export type AppType = typeof app;
export { app };
