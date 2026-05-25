import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  CopyPlus,
  FileJson,
  FileText,
  Heart,
  Plus,
  Save,
  Sparkles,
  Trash2,
  UserCircle2,
  Zap,
} from "lucide-react";
import {
  activeProfile,
  buildPersonalityPrompt,
  defaultProfile,
  type PersonalityFile,
  type PersonalityProfile,
} from "@/lib/personalityPrompt";
import {
  appendImportedProfiles,
  parsePersonalityJson,
  previewFieldSummary,
  previewOpenclawImport,
  type OpenclawImportPreview,
} from "@/lib/personalityImport";
import { pickOpenclawMarkdownFiles, type PickedTextFile } from "@/lib/pickOpenclawFiles";

type Snapshot = {
  file: PersonalityFile;
  generatedSystemPrompt: string;
};

function emptyProfile(id: string, profileName: string): PersonalityProfile {
  return {
    id,
    profileName,
    companionName: "Sage",
    corePersonality: "",
    toneOfVoice: "",
    backgroundStory: "",
    coreValues: "",
    relationshipStyle: "",
    specialInstructions: "",
    avatarDescription: null,
  };
}

type CompanionProps = {
  visible: boolean;
  /** Profile id used for chat memory (from main app state). */
  chatActiveProfileId: string;
  /** Notify chat / MemoryAnchor when the active profile id changes (dropdown, save, new, delete). */
  onActiveProfileMemorySync?: (profileId: string) => void | Promise<void>;
};

export function CompanionPersonalitySection({
  visible,
  chatActiveProfileId,
  onActiveProfileMemorySync,
}: CompanionProps) {
  const [file, setFile] = useState<PersonalityFile | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<"changes" | "new" | null>(null);
  const jsonInputRef = useRef<HTMLInputElement>(null);
  const openclawInputRef = useRef<HTMLInputElement>(null);
  const openclawPreviewRef = useRef<HTMLDivElement>(null);
  const [openclawPreview, setOpenclawPreview] = useState<OpenclawImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);

  const syncMemoryProfile = useCallback(
    (profileId: string) => {
      void onActiveProfileMemorySync?.(profileId);
    },
    [onActiveProfileMemorySync],
  );

  /** Persist personality.json before memory sync (backend only knows saved profile ids). */
  const persistFile = useCallback(async (next: PersonalityFile): Promise<PersonalityFile> => {
    const snap = await invoke<Snapshot>("personality_save", { file: next });
    setFile(snap.file);
    return snap.file;
  }, []);

  const load = useCallback(async () => {
    try {
      setLoadErr(null);
      const snap = await invoke<Snapshot>("personality_get");
      setFile(snap.file);
    } catch (e) {
      setLoadErr(String(e));
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const current = file ? activeProfile(file) : defaultProfile();
  const preview = useMemo(
    () => buildPersonalityPrompt(current),
    [
      current.id,
      current.profileName,
      current.companionName,
      current.corePersonality,
      current.toneOfVoice,
      current.backgroundStory,
      current.coreValues,
      current.relationshipStyle,
      current.specialInstructions,
      current.avatarDescription,
    ],
  );

  const updateActive = (patch: Partial<PersonalityProfile>) => {
    if (!file) return;
    setFile({
      ...file,
      profiles: file.profiles.map((p) =>
        p.id === file.activeProfileId ? { ...p, ...patch } : p,
      ),
    });
  };

  const setActiveId = (id: string) => {
    if (!file) return;
    const nextFile: PersonalityFile = { ...file, activeProfileId: id };
    setFile(nextFile);
    void (async () => {
      setLoadErr(null);
      try {
        const saved = await persistFile(nextFile);
        syncMemoryProfile(saved.activeProfileId);
      } catch (e) {
        setLoadErr(String(e));
      }
    })();
  };

  const addProfile = () => {
    if (!file) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p-${Date.now()}`;
    const next: PersonalityProfile = emptyProfile(id, "New profile");
    const nextFile: PersonalityFile = {
      ...file,
      profiles: [...file.profiles, next],
      activeProfileId: id,
    };
    setFile(nextFile);
    void (async () => {
      setLoadErr(null);
      try {
        const saved = await persistFile(nextFile);
        syncMemoryProfile(saved.activeProfileId);
      } catch (e) {
        setLoadErr(String(e));
      }
    })();
  };

  const deleteActiveProfile = () => {
    if (!file || file.profiles.length <= 1) return;
    const rest = file.profiles.filter((p) => p.id !== file.activeProfileId);
    const nextActive = rest[0]?.id ?? "default";
    const nextFile: PersonalityFile = {
      ...file,
      profiles: rest,
      activeProfileId: nextActive,
    };
    setFile(nextFile);
    void (async () => {
      setLoadErr(null);
      try {
        const saved = await persistFile(nextFile);
        syncMemoryProfile(saved.activeProfileId);
      } catch (e) {
        setLoadErr(String(e));
      }
    })();
  };

  const saveChanges = async () => {
    if (!file) return;
    setSaveMode("changes");
    setSaving(true);
    setLoadErr(null);
    try {
      const snap = await invoke<Snapshot>("personality_save", { file });
      setFile(snap.file);
      syncMemoryProfile(snap.file.activeProfileId);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setSaving(false);
      setSaveMode(null);
    }
  };

  const readFileText = (f: File) =>
    new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(new Error("Could not read file."));
      r.readAsText(f);
    });

  const onPickJson = () => jsonInputRef.current?.click();

  const onJsonSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const f = input.files?.[0];
    input.value = "";
    if (!f || !file) return;
    setLoadErr(null);
    try {
      const text = await readFileText(f);
      const parsed = parsePersonalityJson(text);
      if (parsed.kind === "file") {
        const ok = window.confirm(
          "Replace the entire personality file with this JSON? All current profiles in this form will be replaced (save to disk still required).",
        );
        if (!ok) return;
        setFile(parsed.file);
        syncMemoryProfile(parsed.file.activeProfileId);
        return;
      }
      const ok = window.confirm(
        `Add ${parsed.profiles.length} profile(s) from this JSON to your existing list? IDs will be adjusted if they clash.`,
      );
      if (!ok) return;
      const next = appendImportedProfiles(file, parsed.profiles);
      setFile(next);
      const saved = await persistFile(next);
      syncMemoryProfile(saved.activeProfileId);
    } catch (err) {
      setLoadErr(String(err));
    }
  };

  const processOpenclawFiles = async (parts: PickedTextFile[]) => {
    if (!file) {
      setImportMsg("Personality data is still loading — wait a moment and try again.");
      return;
    }
    setLoadErr(null);
    setImportMsg(null);
    setImportBusy(true);
    try {
      const preview = previewOpenclawImport(parts);
      setOpenclawPreview(preview);
      requestAnimationFrame(() => {
        openclawPreviewRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    } catch (err) {
      setOpenclawPreview(null);
      setImportMsg(String(err));
    } finally {
      setImportBusy(false);
    }
  };

  const onPickOpenclaw = async () => {
    setImportMsg(null);
    try {
      const fromDialog = await pickOpenclawMarkdownFiles();
      if (fromDialog !== null) {
        if (fromDialog.length === 0) return;
        await processOpenclawFiles(fromDialog);
        return;
      }
    } catch (err) {
      setImportMsg(String(err));
      return;
    }
    openclawInputRef.current?.click();
  };

  const onOpenclawSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const list = input.files;
    if (!list?.length) return;
    try {
      const parts: PickedTextFile[] = [];
      for (let i = 0; i < list.length; i++) {
        const f = list[i]!;
        parts.push({ fileName: f.name, text: await readFileText(f) });
      }
      await processOpenclawFiles(parts);
    } finally {
      input.value = "";
    }
  };

  const confirmOpenclawImport = () => {
    if (!file || !openclawPreview || openclawPreview.fatalError) return;
    const next = appendImportedProfiles(file, [openclawPreview.profile]);
    setFile(next);
    void (async () => {
      setLoadErr(null);
      try {
        const saved = await persistFile(next);
        syncMemoryProfile(saved.activeProfileId);
        setOpenclawPreview(null);
        setImportMsg(null);
      } catch (e) {
        setLoadErr(String(e));
      }
    })();
  };

  const cancelOpenclawImport = () => {
    setOpenclawPreview(null);
    setImportMsg(null);
  };

  const saveAsNewProfile = async () => {
    if (!file) return;
    const baseName = current.profileName.trim() || "Profile";
    const suggested = `${baseName} (copy)`;
    const entered = window.prompt("Name for the new profile?", suggested);
    if (entered === null) return;
    const profileName = entered.trim();
    if (!profileName) {
      setLoadErr("New profile needs a name.");
      return;
    }
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p-${Date.now()}`;
    const newProfile: PersonalityProfile = { ...current, id, profileName };
    const nextFile: PersonalityFile = {
      ...file,
      profiles: [...file.profiles, newProfile],
      activeProfileId: id,
    };
    setSaveMode("new");
    setSaving(true);
    setLoadErr(null);
    try {
      const snap = await invoke<Snapshot>("personality_save", { file: nextFile });
      setFile(snap.file);
      syncMemoryProfile(snap.file.activeProfileId);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setSaving(false);
      setSaveMode(null);
    }
  };

  if (!visible) return null;

  const saveFooter =
    file ? (
      <div
        className="-mx-4 shrink-0 border-t border-slate-200 dark:border-slate-800/90 bg-slate-50 dark:bg-slate-950/92 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md"
        role="region"
        aria-label="Save personality profile"
      >
        <div className="grid gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveChanges()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-white shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving && saveMode === "changes" ? (
              "Saving…"
            ) : (
              <>
                <Save className="size-4 shrink-0" aria-hidden />
                Save changes
              </>
            )}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveAsNewProfile()}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-600/90 px-3 py-2.5 text-sm font-semibold text-slate-900 dark:text-white shadow-md shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {saving && saveMode === "new" ? (
              "Saving…"
            ) : (
              <>
                <CopyPlus className="size-4 shrink-0" aria-hidden />
                Save as new profile
              </>
            )}
          </button>
        </div>
        <p className="mt-2 text-[10px] leading-snug text-slate-500">
          <span className="text-indigo-300/90">Save changes</span> updates the profile you&apos;re editing.{" "}
          <span className="text-emerald-300/90">Save as new</span> copies the form to a new profile without
          overwriting others.
        </p>
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-indigo-500/25 bg-gradient-to-b from-indigo-950/40 to-slate-950/40 p-4 shadow-inner">
      {loadErr ? (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-200">
          {loadErr}
        </p>
      ) : null}

      {!file ? (
        <p className="text-xs text-slate-500">Loading personality…</p>
      ) : (
        <>
          <div className="overflow-hidden rounded-xl border border-indigo-400/35 bg-gradient-to-br from-indigo-600/25 via-indigo-950/50 to-slate-950/80 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
            <div className="flex flex-wrap items-center gap-2">
              <UserCircle2 className="size-5 shrink-0 text-indigo-300" aria-hidden />
              <p className="min-w-0 text-base font-semibold tracking-tight text-slate-900 dark:text-white">
                <span className="font-medium text-indigo-200/90">Current profile: </span>
                <span className="truncate">{current.profileName || "Unnamed profile"}</span>
              </p>
              <span className="inline-flex items-center rounded-full border border-indigo-400/40 bg-indigo-500/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-100">
                Editing
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              Companion in chat:{" "}
              <span className="font-medium text-slate-800 dark:text-slate-200">
                {(current.companionName || "Sage").trim() || "Sage"}
              </span>
            </p>
          </div>

          <div className="flex items-start gap-2">
            <Heart className="mt-0.5 size-5 shrink-0 text-indigo-400" aria-hidden />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Customize companion</h3>
              <p className="text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
                Companion personality · saved as <span className="font-mono">personality.json</span> in your data
                folder. The generated prompt is sent with every message as the first system layer.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/25 bg-amber-950/15 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/90">
              Import from file
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Personality JSON</span> — full{" "}
              <span className="font-mono">personality.json</span>, a <span className="font-mono">profiles</span> array,
              or one profile object. <span className="font-medium text-slate-700 dark:text-slate-300">OpenClaw</span> — select{" "}
              <span className="font-mono">SOUL.md</span>, <span className="font-mono">IDENTITY.md</span>,{" "}
              <span className="font-mono">USER.md</span>, <span className="font-mono">JOURNAL.md</span>,{" "}
              <span className="font-mono">MEMORY.md</span>, <span className="font-mono">TOOLS.md</span> (any subset).
              OpenClaw templates use bullet lists (<span className="font-mono">- Name:</span>, etc.) — we map those
              into companion fields, show a preview, then add one profile. Use{" "}
              <span className="text-indigo-300">Save changes</span> to persist.
            </p>
            <input
              ref={jsonInputRef}
              type="file"
              accept=".json,application/json"
              className="sr-only"
              aria-hidden
              onChange={(ev) => void onJsonSelected(ev)}
            />
            <input
              ref={openclawInputRef}
              type="file"
              accept=".md,.markdown,.txt,text/markdown,text/plain"
              multiple
              className="sr-only"
              aria-hidden
              onChange={(ev) => void onOpenclawSelected(ev)}
            />
            {importBusy ? (
              <p className="mt-2 text-[11px] text-slate-600 dark:text-slate-400">Reading markdown files…</p>
            ) : null}
            {importMsg ? (
              <p className="mt-2 rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
                {importMsg}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onPickJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-slate-100 dark:bg-slate-900/80 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-slate-200 dark:bg-slate-800"
              >
                <FileJson className="size-3.5 shrink-0" aria-hidden />
                Import personality JSON…
              </button>
              <button
                type="button"
                onClick={() => void onPickOpenclaw()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-slate-100 dark:bg-slate-900/80 px-3 py-2 text-xs font-medium text-amber-100 hover:bg-slate-200 dark:bg-slate-800"
              >
                <FileText className="size-3.5 shrink-0" aria-hidden />
                Import OpenClaw markdown…
              </button>
            </div>
            {openclawPreview ? (
              <div
                ref={openclawPreviewRef}
                className="mt-3 rounded-lg border border-indigo-500/35 bg-indigo-950/25 p-3"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-200/90">
                  OpenClaw import preview
                </p>
                {openclawPreview.fatalError ? (
                  <p className="mt-2 text-[11px] text-red-300">{openclawPreview.fatalError}</p>
                ) : null}
                <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                  Files:{" "}
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {openclawPreview.filesFound.length > 0
                      ? openclawPreview.filesFound.map((f) => `${f.toUpperCase()}.md`).join(", ")
                      : "(none recognized)"}
                  </span>
                  {openclawPreview.unrecognizedFileNames.length > 0 ? (
                    <span className="text-amber-300/90">
                      {" "}
                      · skipped: {openclawPreview.unrecognizedFileNames.join(", ")}
                    </span>
                  ) : null}
                </p>
                {openclawPreview.missingRecommended.length > 0 ? (
                  <p className="mt-1 text-[11px] text-amber-300/90">
                    Not included (optional): {openclawPreview.missingRecommended.join(", ")}
                  </p>
                ) : null}
                {openclawPreview.warnings.map((w) => (
                  <p key={w} className="mt-1 text-[11px] text-amber-300/90">
                    {w}
                  </p>
                ))}
                <dl className="mt-3 grid gap-2 text-[11px]">
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">Companion</dt>
                    <dd className="text-slate-800 dark:text-slate-200">{openclawPreview.profile.companionName}</dd>
                  </div>
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">Core personality</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {previewFieldSummary(openclawPreview.profile.corePersonality)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">Tone</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {previewFieldSummary(openclawPreview.profile.toneOfVoice)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">Background</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {previewFieldSummary(openclawPreview.profile.backgroundStory)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">User relationship</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {previewFieldSummary(openclawPreview.profile.relationshipStyle)}
                    </dd>
                  </div>
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <dt className="text-slate-500">Special instructions</dt>
                    <dd className="text-slate-600 dark:text-slate-400">
                      {previewFieldSummary(openclawPreview.profile.specialInstructions, 160)}
                    </dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={confirmOpenclawImport}
                    disabled={Boolean(openclawPreview.fatalError)}
                    className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white hover:bg-indigo-400 disabled:opacity-40"
                  >
                    Add profile to list
                  </button>
                  <button
                    type="button"
                    onClick={cancelOpenclawImport}
                    className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:bg-slate-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <label
                  className="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
                  htmlFor="companion-profile-select"
                >
                  Switch profile
                </label>
                <p className="mt-0.5 text-xs leading-snug text-slate-500">
                  Pick a saved profile — the form below updates immediately with that profile&apos;s fields.
                </p>
              </div>
              <span className="hidden text-[10px] text-slate-600 sm:block">
                {file.profiles.length} saved
              </span>
            </div>
            <div className="relative mt-2">
              <ChevronDown
                className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <select
                id="companion-profile-select"
                value={file.activeProfileId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full appearance-none rounded-lg border border-slate-300 dark:border-slate-700/90 bg-slate-100 dark:bg-slate-900/80 py-2.5 pl-3 pr-10 text-sm font-medium text-slate-900 dark:text-slate-100 outline-none ring-indigo-500/0 transition focus:border-indigo-500/55 focus:ring-2 focus:ring-indigo-500/25"
              >
                {file.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profileName || p.id}
                    {p.id === file.activeProfileId ? " · editing" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={addProfile}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:bg-slate-800"
              >
                <Plus className="size-3.5" aria-hidden />
                New blank profile
              </button>
              <button
                type="button"
                disabled={file.profiles.length <= 1}
                onClick={deleteActiveProfile}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-950/50 disabled:opacity-40"
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete this profile
              </button>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-500/35 bg-gradient-to-br from-emerald-950/40 to-slate-950/50 p-3 shadow-inner">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95">
              Load / activate for chat
            </p>
            <p className="mt-1 text-[11px] leading-snug text-slate-600 dark:text-slate-400">
              The companion marked <span className="font-medium text-emerald-200/90">Live in chat</span> is who
              you&apos;re talking to and whose memory is used for new conversations. Same as the picker in the main
              chat header.
            </p>
            <ul className="mt-3 space-y-2" aria-label="Companion profiles">
              {file.profiles.map((p) => {
                const cname = (p.companionName || "").trim() || "Sage";
                const isLiveChat = p.id === chatActiveProfileId;
                return (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-800/90 bg-slate-100/90 dark:bg-slate-950/60 px-2.5 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{cname}</p>
                      <p className="truncate text-[10px] text-slate-500">{p.profileName || p.id}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      {isLiveChat ? (
                        <span className="whitespace-nowrap rounded-full border border-emerald-500/45 bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-100">
                          Live in chat
                        </span>
                      ) : null}
                      <button
                        type="button"
                        disabled={isLiveChat}
                        onClick={() => {
                          setFile({ ...file, activeProfileId: p.id });
                          syncMemoryProfile(p.id);
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-slate-900 dark:text-white shadow-md shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:cursor-default disabled:bg-slate-200 dark:bg-slate-800 disabled:text-slate-500 disabled:shadow-none"
                      >
                        <Zap className="size-3.5 shrink-0" aria-hidden />
                        {isLiveChat ? "Active for chat" : "Load / Activate for chat"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Profile name (preset label)
            </label>
            <input
              value={current.profileName}
              onChange={(e) => updateActive({ profileName: e.target.value })}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Companion name
            </label>
            <input
              value={current.companionName}
              onChange={(e) => updateActive({ companionName: e.target.value })}
              placeholder="Sage"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Core personality
            </label>
            <textarea
              rows={3}
              value={current.corePersonality}
              onChange={(e) => updateActive({ corePersonality: e.target.value })}
              placeholder="e.g. warm, witty, patient, curious…"
              className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Tone of voice
            </label>
            <input
              value={current.toneOfVoice}
              onChange={(e) => updateActive({ toneOfVoice: e.target.value })}
              placeholder="e.g. concise, gentle, playful…"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Background story / role
            </label>
            <textarea
              rows={3}
              value={current.backgroundStory}
              onChange={(e) => updateActive({ backgroundStory: e.target.value })}
              placeholder="Who you are in the user’s world…"
              className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Core values / principles
            </label>
            <textarea
              rows={2}
              value={current.coreValues}
              onChange={(e) => updateActive({ coreValues: e.target.value })}
              placeholder="What you always stand for…"
              className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Relationship style
            </label>
            <input
              value={current.relationshipStyle}
              onChange={(e) => updateActive({ relationshipStyle: e.target.value })}
              placeholder="e.g. friend, mentor, creative partner…"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Special instructions / quirks
            </label>
            <textarea
              rows={2}
              value={current.specialInstructions}
              onChange={(e) => updateActive({ specialInstructions: e.target.value })}
              placeholder="Habits, boundaries, in-jokes…"
              className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Avatar description (optional)
            </label>
            <textarea
              rows={2}
              value={current.avatarDescription ?? ""}
              onChange={(e) =>
                updateActive({
                  avatarDescription: e.target.value.trim() === "" ? null : e.target.value,
                })
              }
              placeholder="For a future AI-generated avatar…"
              className="w-full resize-y rounded-lg border border-slate-200 dark:border-slate-800/90 bg-white/80 dark:bg-slate-950/70 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="size-3.5 text-indigo-400" aria-hidden />
              Live system prompt preview
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-300">
              {preview}
            </pre>
          </div>
        </>
      )}
      </section>
      {saveFooter}
    </div>
  );
}
