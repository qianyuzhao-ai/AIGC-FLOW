import { piConnectionSchema, piModelsRequestSchema } from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { getConfiguredModel, getPiConfiguration, savePiConfiguration } from "../pi/configuration";
import { imageThumbnail } from "../pi/images";
import { discoverPiModels } from "../pi/model-discovery";
import { getPiRuntime } from "../pi/runtime";
import { piRunsRoute } from "./pi-runs";
import { piSkillsRoute } from "./pi-skills";

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Pi 请求失败");

export const piRoute = new Hono()
  .onError((error, c) => c.json({ message: errorMessage(error) }, 400))
  .get("/thumbnail", zValidator("query", z.object({ url: z.url().max(8000) })), async (c) => {
    const thumbnail = await imageThumbnail(c.req.valid("query").url, c.req.raw.signal);
    return c.body(new Uint8Array(thumbnail.bytes), 200, {
      "Content-Type": thumbnail.mimeType,
      "Cache-Control": "private, max-age=3600",
    });
  })
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
  .route("/projects", piRunsRoute)
  .route("/skills", piSkillsRoute);
