import { generateImageRequestSchema, generateVideoRequestSchema } from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { generateImage, generateVideo } from "../lib/generation-service";
export const generateRoute = new Hono()
  .post("/", zValidator("json", generateImageRequestSchema), async (c) => {
    const outcome = await generateImage(c.req.valid("json"));
    return "message" in outcome ? c.json(outcome, 502) : c.json(outcome);
  })
  .post("/video", zValidator("json", generateVideoRequestSchema), async (c) => {
    const outcome = await generateVideo(c.req.valid("json"));
    return "message" in outcome ? c.json(outcome, 502) : c.json(outcome);
  });
