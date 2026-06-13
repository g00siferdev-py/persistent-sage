/** Shared frontend types for Persistent Sage. */

export type {
  ChatMessage,
  MemoryPin,
  StoredAnchor,
  StoredConversation,
  StoredMessage,
  StoredProject,
} from "./chat";
export { storedToChatMessage } from "./chat";

export type AppPlatform = "desktop";

/** Top-level UI mode (Persistent Sage v2). */
export type AppMode = "companion" | "coding";

export interface AppMeta {
  name: "Persistent Sage";
  platform: AppPlatform;
}
