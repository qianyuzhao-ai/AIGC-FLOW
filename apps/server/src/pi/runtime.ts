import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { env } from "../env";

export const agentDir = join(dirname(resolve(env.DATABASE_URL)), "pi");
export const agentWorkspace = join(agentDir, "workspace");
export const modelsPath = join(agentDir, "models.json");

async function createRuntime() {
  const sdk = await import("@earendil-works/pi-coding-agent");
  mkdirSync(agentWorkspace, { recursive: true, mode: 0o700 });
  const models = await sdk.ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath,
    allowModelNetwork: false,
  });
  const settings = sdk.SettingsManager.create(agentWorkspace, agentDir);
  const error = models.getError() ?? settings.drainErrors()[0]?.error.message;
  if (error) throw new Error(error);
  return { sdk, models, settings };
}

let runtime: ReturnType<typeof createRuntime> | undefined;

export function getPiRuntime() {
  runtime ??= createRuntime().catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  return runtime;
}
