/** Minimal editor-tab shape used when reconciling a completed save. */
export type EditorSaveSnapshot = {
  pathRel: string;
  content: string;
  savedContent: string;
};

/**
 * After a successful disk write, record the bytes that were actually written.
 *
 * Do not copy the live tab `content`: keystrokes typed during the save IPC would
 * then match `savedContent` and look clean even though they never hit disk.
 */
export function markWrittenContentSaved<T extends EditorSaveSnapshot>(
  files: T[],
  pathRel: string,
  writtenContent: string,
): T[] {
  return files.map((f) =>
    f.pathRel === pathRel ? { ...f, savedContent: writtenContent } : f,
  );
}

export function editorTabIsDirty(file: EditorSaveSnapshot): boolean {
  return file.content !== file.savedContent;
}
