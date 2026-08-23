/** Open editor tab fields needed to apply a post-turn disk refresh. */
export type RefreshableEditorFile = {
  pathRel: string;
  content: string;
  savedContent: string;
  language: string;
};

/**
 * Merge a `coding_read_file` result into an open tab after an agent turn.
 *
 * The snapshot of "clean" tabs is taken when the turn ends, but the user can
 * start typing while the IPC read is in flight. Never replace a buffer that
 * has become dirty — that would silently drop unsaved keystrokes.
 */
export function applyCleanFileRefresh<T extends RefreshableEditorFile>(
  current: T,
  refreshed: { content: string; language: string },
): T {
  if (current.content !== current.savedContent) {
    return current;
  }
  return {
    ...current,
    content: refreshed.content,
    savedContent: refreshed.content,
    language: refreshed.language,
  };
}
