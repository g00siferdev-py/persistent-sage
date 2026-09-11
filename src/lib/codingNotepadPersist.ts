/** Decision helpers for coding-notepad persist so unsaved edits are not dropped. */

export type CodingNoteLeaveKind = "switch-note" | "collapse" | "unmount" | "create-note";

/**
 * Dirty buffers must be flushed before leaving the current note. The trailing
 * autosave timer is cancelled on those transitions, so skipping the flush
 * permanently drops keystrokes (and can write the old buffer into the next note
 * if load of the next file is slow or fails).
 */
export function codingNoteNeedsFlush(
  dirty: boolean,
  _kind: CodingNoteLeaveKind,
): boolean {
  return dirty;
}

/**
 * Whether expanding/switching should replace the in-memory buffer from disk.
 *
 * Collapse then expand of a note already in memory must keep the live buffer:
 * `CodingNotepad` re-runs load on `open`, which would otherwise wipe unsaved
 * text (including a flush that has not finished writing) that the collapsed
 * preview still showed.
 */
export function shouldReloadCodingNoteFromDisk(opts: {
  open: boolean;
  activeName: string;
  loadedName: string | null;
}): boolean {
  if (!opts.open) return false;
  return opts.loadedName !== opts.activeName;
}

/**
 * After a successful write, only clear dirty if the live buffer still matches
 * what was written (keystrokes during IPC must stay dirty).
 */
export function shouldClearDirtyAfterWrite(opts: {
  writtenName: string;
  writtenContent: string;
  currentName: string;
  currentContent: string;
}): boolean {
  return (
    opts.writtenName === opts.currentName &&
    opts.writtenContent === opts.currentContent
  );
}
