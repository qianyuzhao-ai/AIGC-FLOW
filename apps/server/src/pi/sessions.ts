import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { PiChatMessage } from "@aigc-flow/shared";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { getConfiguredModel } from "./configuration";
import { agentDir, agentWorkspace, getPiRuntime } from "./runtime";

const sessions = new Map<number, Promise<AgentSession>>();

async function createProjectSession(projectId: number) {
  const { sdk, models } = await getPiRuntime();
  const model = await getConfiguredModel();
  const cwd = join(agentWorkspace, String(projectId));
  const sessionDir = join(agentDir, "sessions", String(projectId));
  mkdirSync(cwd, { recursive: true, mode: 0o700 });
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  const settingsManager = sdk.SettingsManager.inMemory({ retry: { enabled: false } });
  const resourceLoader = new sdk.DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt:
      "你是 AIGC-FLOW 的创作助手，使用中文回答。帮助用户讨论创作方案和提示词。当前没有画布操作工具，不能查看或修改画布，也不能声称已经完成这些操作。",
  });
  await resourceLoader.reload();
  const { session } = await sdk.createAgentSession({
    cwd,
    agentDir,
    model,
    modelRuntime: models,
    thinkingLevel: "off",
    tools: [],
    resourceLoader,
    settingsManager,
    sessionManager: sdk.SessionManager.continueRecent(cwd, sessionDir),
  });
  return session;
}

export function getProjectSession(projectId: number) {
  let session = sessions.get(projectId);
  if (!session) {
    session = createProjectSession(projectId).catch((error: unknown) => {
      sessions.delete(projectId);
      throw error;
    });
    sessions.set(projectId, session);
  }
  return session;
}

export function chatMessages(session: AgentSession): PiChatMessage[] {
  return session.sessionManager.getBranch().flatMap((entry) => {
    if (entry.type !== "message") return [];
    const { message } = entry;
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text =
      typeof message.content === "string"
        ? message.content
        : message.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("");
    return [{ id: entry.id, role: message.role, text }];
  });
}
