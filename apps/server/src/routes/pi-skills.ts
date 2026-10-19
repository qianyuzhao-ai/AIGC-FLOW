import {
  MAX_SKILL_ARCHIVE_BYTES,
  piSkillEnabledSchema,
  piSkillGithubSchema,
  piSkillInstallSchema,
  piSkillNameSchema,
} from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { downloadGithubSkills } from "../pi/skills/github";
import { installPreviewSkill, previewSkills } from "../pi/skills/previews";
import { setSkillEnabled, skillRegistry, skillsRoot } from "../pi/skills/store";

export const piSkillsRoute = new Hono()
  .onError((error, c) => c.json({ message: error.message }, 400))
  .get("/", (c) => c.json({ skills: skillRegistry().skills, directory: skillsRoot }))
  .post(
    "/preview",
    bodyLimit({
      maxSize: MAX_SKILL_ARCHIVE_BYTES + 1024 * 1024,
      onError: (c) => c.json({ message: "技能包最多 20 MB" }, 413),
    }),
    async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File) || !/\.(zip|skill)$/i.test(file.name))
        return c.json({ message: "请选择 .skill 或 .zip 技能包" }, 400);
      if (file.size > MAX_SKILL_ARCHIVE_BYTES) return c.json({ message: "技能包最多 20 MB" }, 413);
      return c.json(
        await previewSkills(Buffer.from(await file.arrayBuffer()), `本地：${file.name}`),
      );
    },
  )
  .post("/github/preview", zValidator("json", piSkillGithubSchema), async (c) => {
    const source = await downloadGithubSkills(c.req.valid("json").url, c.req.raw.signal);
    return c.json(await previewSkills(source.bytes, source.source, source.directory));
  })
  .post("/install", zValidator("json", piSkillInstallSchema), async (c) => {
    const { previewId, skillId } = c.req.valid("json");
    return c.json(await installPreviewSkill(previewId, skillId), 201);
  })
  .patch(
    "/:name",
    zValidator("param", z.object({ name: piSkillNameSchema })),
    zValidator("json", piSkillEnabledSchema),
    async (c) =>
      c.json(await setSkillEnabled(c.req.valid("param").name, c.req.valid("json").enabled)),
  );
