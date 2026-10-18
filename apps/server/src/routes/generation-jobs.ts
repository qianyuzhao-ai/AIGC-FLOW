import { generationJobRequestSchema } from "@aigc-flow/shared";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import { findJobByRequest, getJob, startJob } from "../pi/generation-jobs";

const project = z.object({ projectId: z.coerce.number().int().positive() });
export const generationJobsRoute = new Hono()
  .onError((error, c) => c.json({ message: error.message }, 400))
  .get(
    "/:projectId/requests/:requestId",
    zValidator("param", project.extend({ requestId: z.string().min(1) })),
    (c) => {
      const { projectId, requestId } = c.req.valid("param");
      return c.json({ job: findJobByRequest(projectId, requestId) });
    },
  )
  .post(
    "/:projectId/jobs",
    zValidator("param", project),
    zValidator("json", generationJobRequestSchema),
    (c) => c.json(startJob(c.req.valid("param").projectId, c.req.valid("json")), 202),
  )
  .get(
    "/:projectId/jobs/:jobId",
    zValidator("param", project.extend({ jobId: z.string().min(1) })),
    (c) => {
      const { projectId, jobId } = c.req.valid("param");
      const job = getJob(projectId, jobId);
      return job ? c.json(job) : c.json({ message: "任务不存在或不属于当前项目" }, 404);
    },
  );
