import type { CodingViewMode } from "@/hooks/useCodingIde";

type Props = {
  viewMode: CodingViewMode;
  onChange: (mode: CodingViewMode) => void;
  dirtyCount: number;
};

const MODES: { id: CodingViewMode; label: string }[] = [
  { id: "split", label: "Split" },
  { id: "editor", label: "Editor" },
  { id: "chat", label: "Chat" },
  { id: "playground", label: "Playground" },
];

export function CodingViewToolbar({ viewMode, onChange, dirtyCount }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ps-border bg-ps-elevated px-3 py-1.5 dark:border-ps-border dark:bg-ps-elevated">
      <div className="flex rounded-md border border-ps-border bg-white p-0.5 dark:border-ps-border dark:bg-transparent">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
 viewMode === m.id
 ? "bg-ps-accent-hover text-white dark:bg-ps-accent dark:text-ps-accent-fg"
 : "text-ps-muted hover:bg-ps-elevated hover:text-ps-ink dark:text-ps-faint dark:hover:bg-transparent dark:hover:text-ps-ink"
 }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {dirtyCount > 0 ? (
        <span className="text-[10px] text-amber-700 dark:text-amber-400/90">
          {dirtyCount} unsaved file{dirtyCount === 1 ? "" : "s"}
        </span>
      ) : (
        <span className="text-[10px] text-ps-faint dark:text-ps-muted">Ctrl+S to save</span>
      )}
    </div>
  );
}
