import { eq } from "drizzle-orm";
import { db } from "../db";
import { agentCommands, agentRuns, generationJobs } from "../db/schema";

let recovered = false;
export function recoverInterruptedWork() {
  if (recovered) return;
  db.transaction((tx) => {
    tx.update(agentRuns)
      .set({ status: "interrupted", error: "服务重启，未自动重放任务" })
      .where(eq(agentRuns.status, "running"))
      .run();
    tx.update(agentCommands)
      .set({ status: "unknown" })
      .where(eq(agentCommands.status, "pending"))
      .run();
    tx.update(generationJobs)
      .set({ status: "unknown", error: "服务重启，上游结果未知；不会自动再次生成" })
      .where(eq(generationJobs.status, "running"))
      .run();
  });
  recovered = true;
}
