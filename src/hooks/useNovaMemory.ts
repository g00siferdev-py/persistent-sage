import { invoke } from "@tauri-apps/api/core";
import type {
  StoredAnchor,
  StoredConversation,
  StoredMessage,
  StoredProject,
} from "@/types/chat";

export type InvokeMessageRole = "user" | "assistant";

export async function memoryListConversations(): Promise<StoredConversation[]> {
  return invoke<StoredConversation[]>("memory_list_conversations");
}

export async function memoryCreateConversation(title: string): Promise<string> {
  return invoke<string>("memory_create_conversation", { title });
}

export async function memoryGetConversation(
  conversationId: string,
): Promise<StoredConversation> {
  return invoke<StoredConversation>("memory_get_conversation", {
    conversationId,
  });
}

export async function memoryRenameConversation(
  conversationId: string,
  title: string,
): Promise<void> {
  return invoke("memory_rename_conversation", {
    conversationId,
    title,
  });
}

/** Deletes a conversation and its messages (SQLite CASCADE). */
export async function memoryDeleteConversation(conversationId: string): Promise<void> {
  return invoke("delete_conversation", { conversationId });
}

export async function memoryStoreMessage(
  conversationId: string,
  role: InvokeMessageRole,
  content: string,
): Promise<void> {
  return invoke("memory_store_message", {
    conversationId,
    role,
    content,
  });
}

export async function memoryGetRecent(
  conversationId: string,
  limit: number,
): Promise<StoredMessage[]> {
  return invoke<StoredMessage[]>("memory_get_recent", {
    conversationId,
    limit,
  });
}

export async function memoryStartupBriefing(conversationId: string): Promise<string> {
  return invoke<string>("memory_startup_briefing", {
    conversationId,
  });
}

export async function memoryUpdateStartupBriefing(conversationId: string): Promise<string> {
  return invoke<string>("memory_update_startup_briefing", {
    conversationId,
  });
}

export async function memoryCreateAnchor(
  conversationId: string | null,
  anchorType: string,
  content: string,
  importance: number,
): Promise<string> {
  return invoke<string>("memory_create_anchor", {
    conversationId,
    anchorType,
    content,
    importance,
  });
}

export async function memoryExtractAnchorsFromConversation(
  conversationId: string,
  maxAnchors: number,
): Promise<string[]> {
  return invoke<string[]>("memory_extract_anchors_from_conversation", {
    conversationId,
    maxAnchors,
  });
}

export async function memoryRecallAnchors(
  query: string,
  conversationId: string | null,
  limit: number,
): Promise<StoredAnchor[]> {
  return invoke<StoredAnchor[]>("memory_recall_anchors", {
    query,
    conversationId,
    limit,
  });
}

export async function memoryListAnchors(
  conversationId: string,
  limit: number,
): Promise<StoredAnchor[]> {
  return invoke<StoredAnchor[]>("memory_list_anchors", {
    conversationId,
    limit,
  });
}

export async function memoryListProjects(limit: number): Promise<StoredProject[]> {
  return invoke<StoredProject[]>("memory_list_projects", { limit });
}
