/**
 * Conversation used for "current chat" Settings actions (Email Agent bind, new Pulse).
 *
 * Prefer the live sidebar selection over `settings.pulseConversationId`, which is a
 * snapshot loaded when the Settings panel opened and can lag behind a thread switch.
 */
export function liveBoundConversationId(
  activeConversationId: string | null | undefined,
  settingsPulseConversationId: string | null | undefined,
): string | null {
  const live = activeConversationId?.trim();
  if (live) return live;
  const snapshot = settingsPulseConversationId?.trim();
  return snapshot || null;
}
