/** Helpers for coding-mode editor tab open/reload. Isolated for unit tests. */

export type EditorOpenTab = {
  pathRel: string;
  content: string;
  savedContent: string;
  language: string;
  loading?: boolean;
  error?: string | null;
};

/**
 * Re-clicking a loaded tab must only focus it. Re-reading from disk would
 * replace the in-memory buffer — including unsaved edits — with the file on disk.
 * Failed loads may retry.
 */
export function shouldFetchEditorFile(
  tabs: readonly EditorOpenTab[],
  pathRel: string,
): boolean {
  const existing = tabs.find((f) => f.pathRel === pathRel);
  if (!existing) return true;
  return Boolean(existing.error);
}

export function editorTabIsDirty(tab: EditorOpenTab): boolean {
  return tab.content !== tab.savedContent;
}

/**
 * Apply a disk read onto an open tab. Never overwrite a dirty buffer (a stale
 * `coding_read_file` from a re-click or a cancelled sibling open must not wipe
 * keystrokes). Loading placeholders (empty content === savedContent) still fill in.
 */
export function applyOpenedFileFromDisk<T extends EditorOpenTab>(
  tabs: readonly T[],
  pathRel: string,
  disk: { content: string; language: string; pathRel?: string },
): T[] {
  return tabs.map((f) => {
    if (f.pathRel !== pathRel) return f;
    if (!f.loading && editorTabIsDirty(f)) {
      return { ...f, loading: false, error: null };
    }
    return {
      ...f,
      pathRel: disk.pathRel ?? pathRel,
      content: disk.content,
      savedContent: disk.content,
      language: disk.language,
      loading: false,
      error: null,
    };
  });
}
