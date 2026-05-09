/** Shared frontend types for Nova. */

export type {
  ChatMessage,
  MemoryPin,
  StoredAnchor,
  StoredConversation,
  StoredMessage,
  StoredProject,
} from "./chat";
export { storedToChatMessage } from "./chat";

export type NovaPlatform = "desktop";

export interface NovaAppMeta {
  name: "Nova";
  platform: NovaPlatform;
}
