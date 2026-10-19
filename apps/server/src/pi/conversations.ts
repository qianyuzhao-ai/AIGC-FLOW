import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentConversations } from "../db/schema";

export const legacyConversationId = (projectId: number) => `legacy-${projectId}`;

export function listConversations(projectId: number) {
  db.insert(agentConversations)
    .values({ id: legacyConversationId(projectId), projectId, title: "历史对话" })
    .onConflictDoNothing()
    .run();
  return db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.projectId, projectId))
    .orderBy(desc(sql`julianday(${agentConversations.updatedAt})`), desc(sql`rowid`))
    .all();
}

export function getConversation(projectId: number, conversationId?: string) {
  const conversation = !conversationId
    ? listConversations(projectId)[0]
    : db
        .select()
        .from(agentConversations)
        .where(
          and(
            eq(agentConversations.projectId, projectId),
            eq(agentConversations.id, conversationId),
          ),
        )
        .get();
  if (!conversation) throw new Error("对话不存在或不属于当前项目");
  return conversation;
}

export function createConversation(projectId: number) {
  listConversations(projectId);
  const now = new Date().toISOString();
  return db
    .insert(agentConversations)
    .values({ id: randomUUID(), projectId, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function touchConversation(id: string, message: string) {
  const conversation = db
    .select()
    .from(agentConversations)
    .where(eq(agentConversations.id, id))
    .get();
  if (!conversation) throw new Error("对话不存在");
  db.update(agentConversations)
    .set({
      updatedAt: new Date().toISOString(),
      title:
        !conversation.titleCustomized && ["新对话", "历史对话"].includes(conversation.title)
          ? message.slice(0, 40)
          : conversation.title,
    })
    .where(eq(agentConversations.id, id))
    .run();
}

export function renameConversation(projectId: number, conversationId: string, title: string) {
  getConversation(projectId, conversationId);
  return db
    .update(agentConversations)
    .set({ title, titleCustomized: true })
    .where(
      and(eq(agentConversations.projectId, projectId), eq(agentConversations.id, conversationId)),
    )
    .returning()
    .get();
}
