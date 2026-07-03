import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, NotepadText, Plus, Save, Send, Trash2 } from "lucide-react";

type NoteMeta = {
  name: string;
  updatedAt: number;
  sizeBytes: number;
};

type Props = {
  open: boolean;
  onToggle: () => void;
};

const DEFAULT_NOTE = "Notes.txt";
const AUTOSAVE_MS = 1200;

export function CodingNotepad({ open, onToggle }: Props) {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeName, setActiveName] = useState(DEFAULT_NOTE);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const dirtyRef = useRef(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const list = await invoke<NoteMeta[]>("coding_notes_list");
      setNotes(list);
      if (!list.some((n) => n.name === activeName) && list.length > 0) {
        setActiveName(list[0]!.name);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [activeName]);

  const loadNote = useCallback(async (name: string) => {
    setLoading(true);
    setError(null);
    try {
      const content = await invoke<string>("coding_notes_read", { name });
      setDraft(content);
      dirtyRef.current = false;
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (open) void loadNote(activeName);
  }, [activeName, open, loadNote]);

  const persist = useCallback(
    async (name: string, content: string) => {
      setSaving(true);
      setError(null);
      try {
        await invoke("coding_notes_write", { name, content });
        dirtyRef.current = false;
        await loadList();
      } catch (e) {
        setError(String(e));
      } finally {
        setSaving(false);
      }
    },
    [loadList],
  );

  useEffect(() => {
    if (!open || !dirtyRef.current) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void persist(activeName, draft);
    }, AUTOSAVE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
  }, [draft, activeName, open, persist]);

  const handleSave = () => void persist(activeName, draft);

  const handleSubmit = () => {
    const stamp = new Date().toLocaleString();
    const block = draft.trim()
      ? `${draft.trim()}\n\n---\nSaved ${stamp}\n`
      : `---\nSaved ${stamp}\n`;
    setDraft(block);
    dirtyRef.current = true;
    void persist(activeName, block);
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const created = await invoke<string>("coding_notes_create", { name });
      setNewName("");
      await loadList();
      setActiveName(created);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDelete = async () => {
    if (activeName === DEFAULT_NOTE) return;
    if (!window.confirm(`Delete ${activeName}?`)) return;
    try {
      await invoke("coding_notes_delete", { name: activeName });
      setActiveName(DEFAULT_NOTE);
      await loadList();
    } catch (e) {
      setError(String(e));
    }
  };

  const preview = draft.trim().slice(0, 120);

  return (
    <div className="shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900/60 dark:shadow-none">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between border-b border-slate-200 px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        aria-expanded={open}
      >
        <span className="flex items-center gap-1.5">
          <NotepadText className="h-3.5 w-3.5" aria-hidden />
          Notepad
        </span>
        <span>{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div className="space-y-2 p-2">
          <div className="flex items-center gap-1">
            <select
              value={activeName}
              onChange={(e) => setActiveName(e.target.value)}
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-1.5 py-1 text-[11px] text-slate-800 outline-none focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
            >
              {notes.map((n) => (
                <option key={n.name} value={n.name}>
                  {n.name}
                </option>
              ))}
            </select>
            {activeName !== DEFAULT_NOTE ? (
              <button
                type="button"
                onClick={() => void handleDelete()}
                title="Delete note"
                className="rounded-md border border-slate-300 p-1 text-red-600 hover:bg-red-50 dark:border-slate-700 dark:text-red-400 dark:hover:bg-red-950/30"
              >
                <Trash2 className="h-3 w-3" aria-hidden />
              </button>
            ) : null}
          </div>

          <div className="flex gap-1">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="New note name"
              className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newName.trim()}
              className="rounded-md border border-slate-300 bg-slate-50 px-1.5 py-1 text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 py-2 text-[11px] text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              Loading…
            </div>
          ) : (
            <textarea
              value={draft}
              onChange={(e) => {
                dirtyRef.current = true;
                setDraft(e.target.value);
              }}
              placeholder="Jot down ideas, todos, or reminders… Saved to a local .txt file the agent can read."
              rows={6}
              className="w-full resize-y rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-800 outline-none placeholder:text-slate-400 focus:border-violet-500 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:placeholder:text-slate-500"
            />
          )}

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              Submit
            </button>
          </div>
          <p className="text-[10px] leading-relaxed text-slate-500">
            Auto-saves to <span className="font-mono">{activeName}</span>. Ask the agent to read your coding notes.
          </p>
          {error ? <p className="text-[10px] text-red-600 dark:text-red-400">{error}</p> : null}
        </div>
      ) : preview ? (
        <div className="mx-2 mb-2 max-h-24 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-600 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
          {preview}
          {draft.trim().length > 120 ? "…" : ""}
        </div>
      ) : null}
    </div>
  );
}
