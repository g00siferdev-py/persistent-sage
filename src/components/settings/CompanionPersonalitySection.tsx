import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  FileJson,
  FileText,
  Heart,
  Pencil,
  Plus,
  Save,
  Wand2,
  Trash2,
  UserCircle2,
  Zap,
} from "lucide-react";
import {
  activeProfile,
  buildPersonalityPrompt,
  defaultProfile,
  type PersonalityExtraSection,
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

type CompanionView = "overview" | "edit" | "openclaw" | "json";

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
    extraSections: [],
  };
}

const CORE_FIELD_ROWS: Array<{ key: keyof PersonalityProfile; label: string }> = [
  { key: "corePersonality", label: "Core personality" },
  { key: "toneOfVoice", label: "Tone of voice" },
  { key: "backgroundStory", label: "Background & role" },
  { key: "coreValues", label: "Core values" },
  { key: "relationshipStyle", label: "Relationship style" },
  { key: "specialInstructions", label: "Special instructions" },
];

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
  const [view, setView] = useState<CompanionView>("overview");
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
  const [showPromptPreview, setShowPromptPreview] = useState(false);

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

  useEffect(() => {
    if (!visible) setView("overview");
  }, [visible]);

  const current = file ? activeProfile(file) : defaultProfile();
  const extraSections = current.extraSections ?? [];
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
      current.extraSections,
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

  const setExtraSections = (next: PersonalityExtraSection[]) => {
    updateActive({ extraSections: next });
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
    setImportMsg(null);
    try {
      const text = await readFileText(f);
      const parsed = parsePersonalityJson(text);
      if (parsed.kind === "file") {
        const ok = window.confirm(
          "Replace the entire personality file with this JSON? All current profiles will be replaced.",
        );
        if (!ok) return;
        const saved = await persistFile(parsed.file);
        syncMemoryProfile(saved.activeProfileId);
        setImportMsg(`Replaced personality file with ${saved.profiles.length} profile(s).`);
        setView("overview");
        return;
      }
      const ok = window.confirm(
        `Add ${parsed.profiles.length} profile(s) from this JSON to your existing list? IDs will be adjusted if they clash.`,
      );
      if (!ok) return;
      const next = appendImportedProfiles(file, parsed.profiles);
      const saved = await persistFile(next);
      syncMemoryProfile(saved.activeProfileId);
      setImportMsg(`Added ${parsed.profiles.length} profile(s) from JSON.`);
      setView("overview");
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
      const previewResult = previewOpenclawImport(parts);
      setOpenclawPreview(previewResult);
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
        setImportMsg("OpenClaw profile added.");
        setView("overview");
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

  const backButton = (
    <button
      type="button"
      onClick={() => {
        setView("overview");
        setOpenclawPreview(null);
        setImportMsg(null);
        setLoadErr(null);
      }}
      className="inline-flex items-center gap-1.5 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-2.5 py-1.5 text-xs font-medium text-ps-ink hover:bg-ps-accent-soft"
    >
      <ArrowLeft className="size-3.5 shrink-0" aria-hidden />
      Back to companion
    </button>
  );

  const saveFooter =
    file && view === "edit" ? (
      <div
        className="-mx-4 shrink-0 border-t border-ps-border bg-ps-elevated dark:bg-ps-canvas px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.35)] backdrop-blur-md"
        role="region"
        aria-label="Save personality profile"
      >
        <div className="grid gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveChanges()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-ps-accent px-3 py-2.5 text-sm font-semibold text-ps-accent-fg shadow-lg transition hover:bg-ps-accent disabled:opacity-50"
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
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-600/90 px-3 py-2.5 text-sm font-semibold text-ps-ink shadow-md shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:opacity-50"
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
        <p className="mt-2 text-[10px] leading-snug text-ps-faint">
          <span className="text-ps-accent/90">Save changes</span> updates the profile you&apos;re editing.{" "}
          <span className="text-emerald-300/90">Save as new</span> copies the form to a new profile without
          overwriting others.
        </p>
      </div>
    ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <section className="min-h-0 flex-1 space-y-4 overflow-y-auto rounded-xl border border-ps-accent/25 bg-ps-elevated p-4 shadow-inner">
        {loadErr ? (
          <p className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-200">
            {loadErr}
          </p>
        ) : null}

        {!file ? (
          <p className="text-xs text-ps-faint">Loading personality…</p>
        ) : view === "overview" ? (
          <OverviewView
            file={file}
            current={current}
            chatActiveProfileId={chatActiveProfileId}
            importMsg={importMsg}
            showPromptPreview={showPromptPreview}
            preview={preview}
            onTogglePrompt={() => setShowPromptPreview((v) => !v)}
            onSetActiveId={setActiveId}
            onAddProfile={addProfile}
            onDeleteActive={deleteActiveProfile}
            onActivateChat={(id) => {
              setFile({ ...file, activeProfileId: id });
              syncMemoryProfile(id);
            }}
            onNavigate={setView}
          />
        ) : view === "edit" ? (
          <EditView
            current={current}
            extraSections={extraSections}
            preview={preview}
            backButton={backButton}
            onUpdate={updateActive}
            onSetExtraSections={setExtraSections}
          />
        ) : view === "openclaw" ? (
          <OpenclawView
            backButton={backButton}
            importBusy={importBusy}
            importMsg={importMsg}
            openclawPreview={openclawPreview}
            openclawPreviewRef={openclawPreviewRef}
            openclawInputRef={openclawInputRef}
            onPickOpenclaw={() => void onPickOpenclaw()}
            onOpenclawSelected={(ev) => void onOpenclawSelected(ev)}
            onConfirm={confirmOpenclawImport}
            onCancel={cancelOpenclawImport}
          />
        ) : (
          <JsonImportView
            backButton={backButton}
            importMsg={importMsg}
            jsonInputRef={jsonInputRef}
            onPickJson={onPickJson}
            onJsonSelected={(ev) => void onJsonSelected(ev)}
          />
        )}
      </section>
      {saveFooter}
    </div>
  );
}

function OverviewView({
  file,
  current,
  chatActiveProfileId,
  importMsg,
  showPromptPreview,
  preview,
  onTogglePrompt,
  onSetActiveId,
  onAddProfile,
  onDeleteActive,
  onActivateChat,
  onNavigate,
}: {
  file: PersonalityFile;
  current: PersonalityProfile;
  chatActiveProfileId: string;
  importMsg: string | null;
  showPromptPreview: boolean;
  preview: string;
  onTogglePrompt: () => void;
  onSetActiveId: (id: string) => void;
  onAddProfile: () => void;
  onDeleteActive: () => void;
  onActivateChat: (id: string) => void;
  onNavigate: (view: CompanionView) => void;
}) {
  const extras = current.extraSections ?? [];

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-ps-accent/35 bg-ps-accent-soft px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
        <div className="flex flex-wrap items-center gap-2">
          <UserCircle2 className="size-5 shrink-0 text-ps-accent" aria-hidden />
          <p className="min-w-0 text-base font-semibold tracking-tight text-ps-ink">
            <span className="font-medium text-ps-accent/90">Current profile: </span>
            <span className="truncate">{current.profileName || "Unnamed profile"}</span>
          </p>
          {current.id === chatActiveProfileId ? (
            <span className="inline-flex items-center rounded-md border border-emerald-500/45 bg-emerald-600/20 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
              Live in chat
            </span>
          ) : (
            <span className="inline-flex items-center rounded-md border border-ps-accent/40 bg-ps-accent-soft px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ps-accent">
              Editing
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ps-muted">
          Companion in chat:{" "}
          <span className="font-medium text-ps-ink">
            {(current.companionName || "Sage").trim() || "Sage"}
          </span>
        </p>
      </div>

      <div className="flex items-start gap-2">
        <Heart className="mt-0.5 size-5 shrink-0 text-ps-accent" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-ps-ink">Companion personality</h3>
          <p className="text-[11px] leading-relaxed text-ps-muted">
            Saved as <span className="font-mono">personality.json</span>. Edit the form, or import from OpenClaw
            / JSON — changes show up here.
          </p>
        </div>
      </div>

      {importMsg ? (
        <p className="rounded border border-emerald-800/50 bg-emerald-950/30 px-2 py-1.5 text-[11px] text-emerald-200">
          {importMsg}
        </p>
      ) : null}

      <div className="rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <label
              className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint"
              htmlFor="companion-profile-select"
            >
              Switch profile
            </label>
            <p className="mt-0.5 text-xs leading-snug text-ps-faint">
              Pick a saved profile to review or edit.
            </p>
          </div>
          <span className="hidden text-[10px] text-ps-muted sm:block">{file.profiles.length} saved</span>
        </div>
        <div className="relative mt-2">
          <ChevronDown
            className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ps-faint"
            aria-hidden
          />
          <select
            id="companion-profile-select"
            value={file.activeProfileId}
            onChange={(e) => onSetActiveId(e.target.value)}
            className="ps-select w-full py-2.5 pl-3 pr-10 text-sm"
          >
            {file.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.profileName || p.id}
                {p.id === file.activeProfileId ? " · selected" : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddProfile}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-medium text-ps-ink hover:bg-ps-elevated dark:bg-ps-surface"
          >
            <Plus className="size-3.5" aria-hidden />
            New blank profile
          </button>
          <button
            type="button"
            disabled={file.profiles.length <= 1}
            onClick={onDeleteActive}
            className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-950/50 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" aria-hidden />
            Delete this profile
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-emerald-500/35 bg-ps-elevated p-3 shadow-inner">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-300/95">
          Load / activate for chat
        </p>
        <p className="mt-1 text-[11px] leading-snug text-ps-muted">
          The companion marked <span className="font-medium text-emerald-200/90">Live in chat</span> is who
          you&apos;re talking to and whose memory is used for new conversations.
        </p>
        <ul className="mt-3 space-y-2" aria-label="Companion profiles">
          {file.profiles.map((p) => {
            const cname = (p.companionName || "").trim() || "Sage";
            const isLiveChat = p.id === chatActiveProfileId;
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas px-2.5 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ps-ink">{cname}</p>
                  <p className="truncate text-[10px] text-ps-faint">{p.profileName || p.id}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  {isLiveChat ? (
                    <span className="whitespace-nowrap rounded-md border border-emerald-500/45 bg-emerald-600/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-100">
                      Live in chat
                    </span>
                  ) : null}
                  <button
                    type="button"
                    disabled={isLiveChat}
                    onClick={() => onActivateChat(p.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-ps-ink shadow-md shadow-emerald-950/40 transition hover:bg-emerald-500 disabled:cursor-default disabled:bg-ps-elevated dark:disabled:bg-ps-surface disabled:text-ps-faint disabled:shadow-none"
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

      <div className="rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Current personality
        </p>
        <dl className="mt-3 grid gap-2.5 text-[11px]">
          {CORE_FIELD_ROWS.map(({ key, label }) => {
            const value = String(current[key] ?? "");
            return (
              <div key={key} className="grid grid-cols-[7.5rem_1fr] gap-2">
                <dt className="text-ps-faint">{label}</dt>
                <dd className="text-ps-muted">{previewFieldSummary(value)}</dd>
              </div>
            );
          })}
          {current.avatarDescription?.trim() ? (
            <div className="grid grid-cols-[7.5rem_1fr] gap-2">
              <dt className="text-ps-faint">Avatar</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(current.avatarDescription)}
              </dd>
            </div>
          ) : null}
          {extras.map((s, i) => (
            <div key={`extra-${i}-${s.title}`} className="grid grid-cols-[7.5rem_1fr] gap-2">
              <dt className="text-ps-faint">{s.title.trim() || "Custom"}</dt>
              <dd className="text-ps-muted">{previewFieldSummary(s.content)}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">Manage</p>
        <nav className="grid gap-2" aria-label="Companion submenus">
          <SubmenuNavCard
            icon={Pencil}
            title="Edit companion"
            description="Fill out or refine the personality form and custom sections."
            onClick={() => onNavigate("edit")}
          />
          <SubmenuNavCard
            icon={FileText}
            title="Import from OpenClaw"
            description="Map SOUL.md, IDENTITY.md, USER.md, and related markdown into a profile."
            onClick={() => onNavigate("openclaw")}
          />
          <SubmenuNavCard
            icon={FileJson}
            title="Import JSON"
            description="Load a personality.json export or a profile from an external editor."
            onClick={() => onNavigate("json")}
          />
        </nav>
      </div>

      <div className="space-y-2">
        <button
          type="button"
          onClick={onTogglePrompt}
          className="flex w-full items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-ps-faint hover:text-ps-muted dark:hover:text-ps-muted"
        >
          <Wand2 className="size-3.5 text-ps-accent" aria-hidden />
          Live system prompt preview
          <ChevronRight
            className={`ml-auto size-3.5 transition ${showPromptPreview ? "rotate-90" : ""}`}
            aria-hidden
          />
        </button>
        {showPromptPreview ? (
          <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas p-3 font-mono text-[11px] leading-relaxed text-ps-muted">
            {preview}
          </pre>
        ) : null}
      </div>
    </>
  );
}

function SubmenuNavCard({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Pencil;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-ps-accent/30 bg-ps-accent-soft px-3 py-3 text-left transition hover:border-ps-accent/50 hover:bg-ps-accent-soft"
    >
      <Icon className="mt-0.5 size-4 shrink-0 text-ps-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-ps-ink">{title}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ps-muted">
          {description}
        </span>
      </span>
      <ChevronRight className="mt-1 size-4 shrink-0 text-ps-faint" aria-hidden />
    </button>
  );
}

function EditView({
  current,
  extraSections,
  preview,
  backButton,
  onUpdate,
  onSetExtraSections,
}: {
  current: PersonalityProfile;
  extraSections: PersonalityExtraSection[];
  preview: string;
  backButton: React.ReactNode;
  onUpdate: (patch: Partial<PersonalityProfile>) => void;
  onSetExtraSections: (next: PersonalityExtraSection[]) => void;
}) {
  const updateExtra = (index: number, patch: Partial<PersonalityExtraSection>) => {
    onSetExtraSections(extraSections.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeExtra = (index: number) => {
    onSetExtraSections(extraSections.filter((_, i) => i !== index));
  };

  const moveExtra = (index: number, dir: -1 | 1) => {
    const next = [...extraSections];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    const tmp = next[index]!;
    next[index] = next[j]!;
    next[j] = tmp;
    onSetExtraSections(next);
  };

  return (
    <>
      {backButton}
      <div className="flex items-start gap-2">
        <Pencil className="mt-0.5 size-5 shrink-0 text-ps-accent" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-ps-ink">Edit companion</h3>
          <p className="text-[11px] leading-relaxed text-ps-muted">
            Core fields stay simple. Add custom sections below when you need more depth.
          </p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Profile name (preset label)
        </label>
        <input
          value={current.profileName}
          onChange={(e) => onUpdate({ profileName: e.target.value })}
          className="w-full rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Companion name
        </label>
        <input
          value={current.companionName}
          onChange={(e) => onUpdate({ companionName: e.target.value })}
          placeholder="Sage"
          className="w-full rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Core personality
        </label>
        <textarea
          rows={3}
          value={current.corePersonality}
          onChange={(e) => onUpdate({ corePersonality: e.target.value })}
          placeholder="e.g. warm, witty, patient, curious…"
          className="w-full resize-y rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Tone of voice
        </label>
        <input
          value={current.toneOfVoice}
          onChange={(e) => onUpdate({ toneOfVoice: e.target.value })}
          placeholder="e.g. concise, gentle, playful…"
          className="w-full rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Background story / role
        </label>
        <textarea
          rows={3}
          value={current.backgroundStory}
          onChange={(e) => onUpdate({ backgroundStory: e.target.value })}
          placeholder="Who you are in the user’s world…"
          className="w-full resize-y rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Core values / principles
        </label>
        <textarea
          rows={2}
          value={current.coreValues}
          onChange={(e) => onUpdate({ coreValues: e.target.value })}
          placeholder="What you always stand for…"
          className="w-full resize-y rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Relationship style
        </label>
        <input
          value={current.relationshipStyle}
          onChange={(e) => onUpdate({ relationshipStyle: e.target.value })}
          placeholder="e.g. friend, mentor, creative partner…"
          className="w-full rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Special instructions / quirks
        </label>
        <textarea
          rows={2}
          value={current.specialInstructions}
          onChange={(e) => onUpdate({ specialInstructions: e.target.value })}
          placeholder="Habits, boundaries, in-jokes…"
          className="w-full resize-y rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-1">
        <label className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          Avatar description (optional)
        </label>
        <textarea
          rows={2}
          value={current.avatarDescription ?? ""}
          onChange={(e) =>
            onUpdate({
              avatarDescription: e.target.value.trim() === "" ? null : e.target.value,
            })
          }
          placeholder="For a future AI-generated avatar…"
          className="w-full resize-y rounded-lg border border-ps-border bg-white/80 dark:bg-ps-canvas px-3 py-2 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
        />
      </div>

      <div className="space-y-3 rounded-lg border border-ps-accent/30 bg-ps-accent-soft p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ps-accent/90">
              Custom sections
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-ps-muted">
              Optional. Each section becomes a heading in the system prompt — useful for complex personas or
              imports from an external personality editor.
            </p>
          </div>
          <button
            type="button"
            onClick={() => onSetExtraSections([...extraSections, { title: "", content: "" }])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-ps-accent/40 bg-ps-accent-hover/30 px-2.5 py-1.5 text-xs font-medium text-ps-accent hover:bg-ps-accent-hover/45"
          >
            <Plus className="size-3.5" aria-hidden />
            Add section
          </button>
        </div>
        {extraSections.length === 0 ? (
          <p className="text-[11px] text-ps-faint">No custom sections yet.</p>
        ) : (
          <ul className="space-y-3">
            {extraSections.map((s, i) => (
              <li
                key={`extra-edit-${i}`}
                className="space-y-2 rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas p-2.5"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={s.title}
                    onChange={(e) => updateExtra(i, { title: e.target.value })}
                    placeholder="Section title"
                    className="min-w-0 flex-1 rounded-md border border-ps-border bg-white/80 dark:bg-ps-canvas px-2.5 py-1.5 text-sm text-ps-ink outline-none focus:border-ps-accent/50"
                  />
                  <button
                    type="button"
                    disabled={i === 0}
                    onClick={() => moveExtra(i, -1)}
                    className="rounded border border-ps-border px-2 py-1 text-[10px] text-ps-muted disabled:opacity-40"
                    aria-label="Move section up"
                  >
                    Up
                  </button>
                  <button
                    type="button"
                    disabled={i >= extraSections.length - 1}
                    onClick={() => moveExtra(i, 1)}
                    className="rounded border border-ps-border px-2 py-1 text-[10px] text-ps-muted disabled:opacity-40"
                    aria-label="Move section down"
                  >
                    Down
                  </button>
                  <button
                    type="button"
                    onClick={() => removeExtra(i)}
                    className="inline-flex items-center gap-1 rounded border border-red-900/40 bg-red-950/30 px-2 py-1 text-[10px] font-medium text-red-200 hover:bg-red-950/50"
                  >
                    <Trash2 className="size-3" aria-hidden />
                    Remove
                  </button>
                </div>
                <textarea
                  rows={3}
                  value={s.content}
                  onChange={(e) => updateExtra(i, { content: e.target.value })}
                  placeholder="Section content…"
                  className="w-full resize-y rounded-md border border-ps-border bg-white/80 dark:bg-ps-canvas px-2.5 py-1.5 text-sm text-ps-ink placeholder:text-ps-faint dark:placeholder:text-ps-muted outline-none focus:border-ps-accent/50"
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
          <Wand2 className="size-3.5 text-ps-accent" aria-hidden />
          Live system prompt preview
        </div>
        <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-ps-border bg-ps-elevated dark:bg-ps-canvas p-3 font-mono text-[11px] leading-relaxed text-ps-muted">
          {preview}
        </pre>
      </div>
    </>
  );
}

function OpenclawView({
  backButton,
  importBusy,
  importMsg,
  openclawPreview,
  openclawPreviewRef,
  openclawInputRef,
  onPickOpenclaw,
  onOpenclawSelected,
  onConfirm,
  onCancel,
}: {
  backButton: React.ReactNode;
  importBusy: boolean;
  importMsg: string | null;
  openclawPreview: OpenclawImportPreview | null;
  openclawPreviewRef: React.RefObject<HTMLDivElement | null>;
  openclawInputRef: React.RefObject<HTMLInputElement | null>;
  onPickOpenclaw: () => void;
  onOpenclawSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {backButton}
      <div className="flex items-start gap-2">
        <FileText className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-ps-ink">Import from OpenClaw</h3>
          <p className="text-[11px] leading-relaxed text-ps-muted">
            Select <span className="font-mono">SOUL.md</span>, <span className="font-mono">IDENTITY.md</span>,{" "}
            <span className="font-mono">USER.md</span>, <span className="font-mono">JOURNAL.md</span>,{" "}
            <span className="font-mono">MEMORY.md</span>, <span className="font-mono">TOOLS.md</span> (any
            subset). We map those into companion fields, show a preview, then add one profile.
          </p>
        </div>
      </div>

      <input
        ref={openclawInputRef}
        type="file"
        accept=".md,.markdown,.txt,text/markdown,text/plain"
        multiple
        className="sr-only"
        aria-hidden
        onChange={onOpenclawSelected}
      />

      {importBusy ? (
        <p className="text-[11px] text-ps-muted">Reading markdown files…</p>
      ) : null}
      {importMsg ? (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
          {importMsg}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onPickOpenclaw}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-medium text-amber-100 hover:bg-ps-accent-soft"
      >
        <FileText className="size-3.5 shrink-0" aria-hidden />
        Import OpenClaw markdown…
      </button>

      {openclawPreview ? (
        <div
          ref={openclawPreviewRef}
          className="rounded-lg border border-ps-accent/40 bg-ps-accent-soft p-3"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-ps-accent/90">
            OpenClaw import preview
          </p>
          {openclawPreview.fatalError ? (
            <p className="mt-2 text-[11px] text-red-300">{openclawPreview.fatalError}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-ps-muted">
            Files:{" "}
            <span className="font-mono text-ps-muted">
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
              <dt className="text-ps-faint">Companion</dt>
              <dd className="text-ps-ink">{openclawPreview.profile.companionName}</dd>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-ps-faint">Core personality</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(openclawPreview.profile.corePersonality)}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-ps-faint">Tone</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(openclawPreview.profile.toneOfVoice)}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-ps-faint">Background</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(openclawPreview.profile.backgroundStory)}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-ps-faint">User relationship</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(openclawPreview.profile.relationshipStyle)}
              </dd>
            </div>
            <div className="grid grid-cols-[7rem_1fr] gap-2">
              <dt className="text-ps-faint">Special instructions</dt>
              <dd className="text-ps-muted">
                {previewFieldSummary(openclawPreview.profile.specialInstructions, 160)}
              </dd>
            </div>
          </dl>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onConfirm}
              disabled={Boolean(openclawPreview.fatalError)}
              className="rounded-lg bg-ps-accent px-3 py-1.5 text-xs font-medium text-ps-accent-fg hover:bg-ps-accent-hover disabled:opacity-40"
            >
              Add profile to list
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-ps-border px-3 py-1.5 text-xs text-ps-muted hover:bg-ps-accent-soft"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

function JsonImportView({
  backButton,
  importMsg,
  jsonInputRef,
  onPickJson,
  onJsonSelected,
}: {
  backButton: React.ReactNode;
  importMsg: string | null;
  jsonInputRef: React.RefObject<HTMLInputElement | null>;
  onPickJson: () => void;
  onJsonSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <>
      {backButton}
      <div className="flex items-start gap-2">
        <FileJson className="mt-0.5 size-5 shrink-0 text-amber-300" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-ps-ink">Import JSON</h3>
          <p className="text-[11px] leading-relaxed text-ps-muted">
            Accepts a full <span className="font-mono">personality.json</span>, a{" "}
            <span className="font-mono">profiles</span> array, or one profile object. Custom{" "}
            <span className="font-mono">extraSections</span> from an external personality editor are preserved
            and appear in the companion overview.
          </p>
        </div>
      </div>

      <input
        ref={jsonInputRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-hidden
        onChange={onJsonSelected}
      />

      {importMsg ? (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-[11px] text-amber-200">
          {importMsg}
        </p>
      ) : null}

      <button
        type="button"
        onClick={onPickJson}
        className="inline-flex items-center gap-1.5 rounded-lg border border-amber-700/50 bg-ps-elevated dark:bg-ps-elevated px-3 py-2 text-xs font-medium text-amber-100 hover:bg-ps-accent-soft"
      >
        <FileJson className="size-3.5 shrink-0" aria-hidden />
        Import personality JSON…
      </button>
    </>
  );
}
