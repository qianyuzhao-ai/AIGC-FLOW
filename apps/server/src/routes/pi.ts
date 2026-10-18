import { piConnectionSchema, piModelsRequestSchema } from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { getConfiguredModel, getPiConfiguration, savePiConfiguration } from "../pi/configuration";
import { discoverPiModels } from "../pi/model-discovery";
import { getPiRuntime } from "../pi/runtime";
import { piRunsRoute } from "./pi-runs";

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
  .route("/projects", piRunsRoute);
