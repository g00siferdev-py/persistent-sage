/** Decide whether a coding-chat transcript fetch may paint into the visible pane. */

export type CodingTranscriptLoadTarget = {
  loadedConversationId: string;
  loadedRepoId?: string | null;
  activeConversationId: string | null;
  activeRepoId: string | null;
};

/**
 * A completed coding turn captures its conversation/repo at send time. If the user
 * switches repositories before `chat_send_message` returns, applying that reload
 * would show repo A's transcript under repo B and make the next send run tools
 * against the wrong tree.
 */
export function shouldApplyCodingTranscriptLoad(
  target: CodingTranscriptLoadTarget,
): boolean {
  const loadedConv = target.loadedConversationId.trim();
  const activeConv = target.activeConversationId?.trim() ?? "";
  if (!loadedConv || !activeConv || loadedConv !== activeConv) {
    return false;
  }
  const loadedRepo = target.loadedRepoId?.trim() ?? "";
  const activeRepo = target.activeRepoId?.trim() ?? "";
  if (loadedRepo && activeRepo && loadedRepo !== activeRepo) {
    return false;
  }
  return true;
}
