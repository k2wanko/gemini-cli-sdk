import fs from "node:fs/promises";
import path from "node:path";
import {
  type ConversationRecord,
  type Config as CoreConfig,
  type MessageRecord,
  type ResumedSessionData,
  SESSION_FILE_PREFIX,
} from "@google/gemini-cli-core";
import type { Content, Part } from "@google/genai";

export type { ConversationRecord, MessageRecord, ResumedSessionData };

export interface SessionInfo {
  sessionId: string;
  filePath: string;
  startTime: string;
  lastUpdated: string;
  messageCount: number;
  summary?: string;
}

/** List available sessions for the current project */
export async function listSessions(config: CoreConfig): Promise<SessionInfo[]> {
  const chatsDir = path.join(config.storage.getProjectTempDir(), "chats");
  let files: string[];
  try {
    files = await fs.readdir(chatsDir);
  } catch {
    return [];
  }
  const sessionFiles = files
    .filter((f) => f.startsWith(SESSION_FILE_PREFIX) && f.endsWith(".json"))
    .sort((a, b) => b.localeCompare(a)); // newest first

  const sessions: SessionInfo[] = [];
  for (const file of sessionFiles) {
    try {
      const filePath = path.join(chatsDir, file);
      const raw = await fs.readFile(filePath, "utf-8");
      const conv: ConversationRecord = JSON.parse(raw);
      sessions.push({
        sessionId: conv.sessionId,
        filePath,
        startTime: conv.startTime,
        lastUpdated: conv.lastUpdated,
        messageCount: conv.messages.length,
        summary: conv.summary,
      });
    } catch {
      /* skip corrupted files */
    }
  }
  return sessions;
}

/** Load a session file into ResumedSessionData */
export async function loadSession(
  filePath: string,
): Promise<ResumedSessionData> {
  const raw = await fs.readFile(filePath, "utf-8");
  const conversation: ConversationRecord = JSON.parse(raw);
  return { conversation, filePath };
}

/** Convert MessageRecord[] to Content[] for API history reconstruction */
export function messageRecordsToHistory(messages: MessageRecord[]): Content[] {
  const history: Content[] = [];
  for (const msg of messages) {
    if (msg.type === "info" || msg.type === "error" || msg.type === "warning") {
      continue;
    }

    if (msg.type === "user") {
      const parts = normalizeParts(msg.content);
      if (parts.length > 0) history.push({ role: "user", parts });
    }

    if (msg.type === "gemini") {
      const modelParts: Part[] = [];
      const contentParts = normalizeParts(msg.content);
      modelParts.push(...contentParts);
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          modelParts.push({
            functionCall: { id: tc.id, name: tc.name, args: tc.args },
          });
        }
      }
      if (modelParts.length > 0) {
        history.push({ role: "model", parts: modelParts });
      }

      // Function response parts (user role)
      if (msg.toolCalls?.some((tc) => tc.result != null)) {
        const responseParts: Part[] = [];
        for (const tc of msg.toolCalls) {
          if (tc.result != null) {
            responseParts.push(...normalizeParts(tc.result));
          }
        }
        if (responseParts.length > 0) {
          history.push({ role: "user", parts: responseParts });
        }
      }
    }
  }
  return history;
}

function normalizeParts(content: unknown): Part[] {
  if (!content) return [];
  if (typeof content === "string") return [{ text: content }];
  if (Array.isArray(content)) {
    return content.map((item) =>
      typeof item === "string" ? { text: item } : (item as Part),
    );
  }
  return [content as Part];
}
