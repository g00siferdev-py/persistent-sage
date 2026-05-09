import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Heart, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import {
  activeProfile,
  buildPersonalityPrompt,
  defaultProfile,
  type PersonalityFile,
  type PersonalityProfile,
} from "@/lib/personalityPrompt";

type Snapshot = {
  file: PersonalityFile;
  generatedSystemPrompt: string;
};

function emptyProfile(id: string, profileName: string): PersonalityProfile {
  return {
    id,
    profileName,
    companionName: "Nova",
    corePersonality: "",
    toneOfVoice: "",
    backgroundStory: "",
    coreValues: "",
    relationshipStyle: "",
    specialInstructions: "",
    avatarDescription: null,
  };
}

export function CompanionPersonalitySection({ visible }: { visible: boolean }) {
  const [file, setFile] = useState<PersonalityFile | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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
    setFile({ ...file, activeProfileId: id });
  };

  const addProfile = () => {
    if (!file) return;
    const id =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `p-${Date.now()}`;
    const next: PersonalityProfile = emptyProfile(id, "New profile");
    setFile({
      ...file,
      profiles: [...file.profiles, next],
      activeProfileId: id,
    });
  };

  const deleteActiveProfile = () => {
    if (!file || file.profiles.length <= 1) return;
    const rest = file.profiles.filter((p) => p.id !== file.activeProfileId);
    setFile({
      ...file,
      profiles: rest,
      activeProfileId: rest[0]?.id ?? "default",
    });
  };

  const save = async () => {
    if (!file) return;
    setSaving(true);
    setLoadErr(null);
    try {
      const snap = await invoke<Snapshot>("personality_save", { file });
      setFile(snap.file);
    } catch (e) {
      setLoadErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  if (!visible) return null;

  return (
    <section className="space-y-4 rounded-xl border border-indigo-500/25 bg-gradient-to-b from-indigo-950/40 to-slate-950/40 p-4 shadow-inner">
      <div className="flex items-start gap-2">
        <Heart className="mt-0.5 size-5 shrink-0 text-indigo-400" aria-hidden />
        <div>
          <h3 className="text-sm font-semibold text-white">Customize Nova</h3>
          <p className="text-[11px] leading-relaxed text-slate-400">
            Companion personality · saved as <span className="font-mono">personality.json</span> in your data
            folder. The generated prompt is sent with every message as the first system layer.
          </p>
        </div>
      </div>

      {loadErr ? (
        <p className="rounded border border-amber-900/50 bg-amber-950/30 px-2 py-1.5 text-xs text-amber-200">
          {loadErr}
        </p>
      ) : null}

      {!file ? (
        <p className="text-xs text-slate-500">Loading personality…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Active profile
              </label>
              <select
                value={file.activeProfileId}
                onChange={(e) => setActiveId(e.target.value)}
                className="w-full rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
              >
                {file.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.profileName || p.id}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={addProfile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <Plus className="size-3.5" aria-hidden />
              Add profile
            </button>
            <button
              type="button"
              disabled={file.profiles.length <= 1}
              onClick={deleteActiveProfile}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-900/40 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200 hover:bg-red-950/50 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" aria-hidden />
              Delete
            </button>
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Profile name (preset label)
            </label>
            <input
              value={current.profileName}
              onChange={(e) => updateActive({ profileName: e.target.value })}
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Companion name
            </label>
            <input
              value={current.companionName}
              onChange={(e) => updateActive({ companionName: e.target.value })}
              placeholder="Nova"
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
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
              className="w-full resize-y rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
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
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
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
              className="w-full resize-y rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
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
              className="w-full resize-y rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
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
              className="w-full rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none focus:border-indigo-500/50"
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
              className="w-full resize-y rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
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
              className="w-full resize-y rounded-lg border border-slate-800/90 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 outline-none focus:border-indigo-500/50"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <Sparkles className="size-3.5 text-indigo-400" aria-hidden />
              Live system prompt preview
            </div>
            <pre className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-800/80 bg-slate-950/80 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
              {preview}
            </pre>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-900/30 transition hover:bg-indigo-500 disabled:opacity-50"
          >
            {saving ? (
              "Saving…"
            ) : (
              <>
                <Save className="size-4" aria-hidden />
                Save personality
              </>
            )}
          </button>
        </>
      )}
    </section>
  );
}
