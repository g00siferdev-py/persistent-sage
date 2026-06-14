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
];

export function CodingViewToolbar({ viewMode, onChange, dirtyCount }: Props) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/60 px-3 py-1.5">
      <div className="flex rounded-md border border-slate-700 p-0.5">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => onChange(m.id)}
            className={`rounded px-2.5 py-0.5 text-[11px] font-medium ${
              viewMode === m.id
                ? "bg-violet-800 text-violet-50"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
      {dirtyCount > 0 ? (
        <span className="text-[10px] text-amber-400/90">
          {dirtyCount} unsaved file{dirtyCount === 1 ? "" : "s"}
        </span>
      ) : (
        <span className="text-[10px] text-slate-600">Ctrl+S to save</span>
      )}
    </div>
  );
}
