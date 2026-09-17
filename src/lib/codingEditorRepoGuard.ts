/** Open editor tab fields needed to keep async disk I/O bound to one repo. */
export type RepoGuardedEditorFile = {
  pathRel: string;
  content: string;
  savedContent: string;
  language: string;
  repoId: string;
  loading?: boolean;
  error?: string | null;
};

export type StashedRepoBuffers<T extends RepoGuardedEditorFile> = {
  files: T[];
  activePath: string | null;
};

/**
 * True when an in-flight `coding_read_file` / refresh still belongs to the
 * visible repo. Repo switches bump `currentSeq` so a slow read cannot land
 * in another project's tab with the same relative path.
 */
export function shouldApplyAsyncEditorResult(args: {
  startedSeq: number;
  currentSeq: number;
  startedRepoId: string;
  currentRepoId: string | null;
}): boolean {
  return (
    args.startedSeq === args.currentSeq &&
    args.currentRepoId != null &&
    args.startedRepoId === args.currentRepoId
  );
}

/** Refuse Save when the tab was opened against a different repo than the one now active. */
export function canSaveEditorFile(
  file: { repoId: string; loading?: boolean; error?: string | null },
  activeRepoId: string | null,
): boolean {
  if (!activeRepoId) return false;
  if (file.loading || file.error) return false;
  return file.repoId === activeRepoId;
}

/**
 * Merge a disk read into the matching tab after an agent turn.
 * Never apply across repos, and never replace a buffer that has become dirty.
 */
export function applyRepoFileRefresh<T extends RepoGuardedEditorFile>(
  tabs: T[],
  read: { pathRel: string; content: string; language: string; repoId: string },
): T[] {
  return tabs.map((tab) => {
    if (tab.pathRel !== read.pathRel) return tab;
    if (tab.repoId !== read.repoId) return tab;
    if (tab.content !== tab.savedContent) return tab;
    return {
      ...tab,
      content: read.content,
      savedContent: read.content,
      language: read.language,
      loading: false,
      error: null,
    };
  });
}

/** Keep unsaved tabs when leaving a repo; clean tabs reload from disk on return. */
export function dirtyBuffersToStash<T extends RepoGuardedEditorFile>(
  files: T[],
  activePath: string | null,
): StashedRepoBuffers<T> | null {
  const filesToKeep = files.filter((f) => f.content !== f.savedContent);
  if (filesToKeep.length === 0) return null;
  const activeStillOpen = filesToKeep.some((f) => f.pathRel === activePath);
  return {
    files: filesToKeep,
    activePath: activeStillOpen ? activePath : filesToKeep[filesToKeep.length - 1].pathRel,
  };
}
