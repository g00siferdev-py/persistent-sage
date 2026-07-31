import { useEffect, useRef, useState, type FormEvent } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { invoke } from "@tauri-apps/api/core";
import {
  Brain,
  Camera,
  ChevronDown,
  FolderOpen,
  Globe,
  ImagePlus,
  Loader2,
  OctagonX,
  PanelRightOpen,
  Send,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/types/chat";
import type { StreamAssistantState } from "@/hooks/useChat";
import { fileFromImageBlob, readImageFileAsDataUrl } from "@/lib/chatAttachments";
import { settingsLayoutLabel, type SettingsLayoutMode } from "@/lib/settingsLayout";
import { formatChatHeader } from "@/lib/chatTimestamp";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { FavoritesPanel } from "@/components/chat/FavoritesPanel";
import { MessageActions } from "@/components/chat/MessageActions";
import { MessageContent } from "@/components/chat/MessageContent";
import { MoltbookPanel } from "@/components/chat/MoltbookPanel";
import { WebcamCaptureModal } from "@/components/chat/WebcamCaptureModal";

export type CompanionHeaderOption = {
  id: string;
  companionName: string;
  profileName: string;
};

export type PendingComposerImage = {
  file: File;
  previewUrl: string;
  base64: string;
  mime: string;
};

type Props = {
  title: string;
  subtitle: string;
  /** When false, the user must start a thread from the sidebar — sending would otherwise no-op. */
  hasActiveConversation: boolean;
  messages: ChatMessage[];
  threadLoading: boolean;
  sending: boolean;
  streamAssistant: StreamAssistantState;
  error: string | null;
  recipes: { id: string; name: string; description?: string }[];
  onRunRecipe: (id: string) => void;
  onSubmitArtifactForm: (
    artifactTitle: string,
    projectId: string | undefined,
    values: Record<string, unknown>,
  ) => void;
  projectList: { id: string; title: string; kind?: string }[];
  activeProjectId: string | null;
  onContinueProject: (id: string, title: string) => void;
  onOpenProjectWorkspace: () => void;
  settingsLayoutMode: SettingsLayoutMode;
  onCycleSettingsLayout: () => void;
  onSendMessage: (text: string, image?: PendingComposerImage | null) => void;
  /** Abort the currently running turn (frontend-only stop). */
  onAbortTurn?: () => void;
  /** Active provider + model accept images (from `chat_vision_supported`). */
  visionSupported: boolean;
  /** Which companion profile is active for memory + new chats. */
  activeCompanionProfileId: string;
  activeCompanionLabel: string;
  companionOptions: CompanionHeaderOption[];
  /** Called when the user picks a companion; awaited from the select handler when async. */
  onCompanionChange: (profileId: string) => void | Promise<unknown>;
  thinkingEffort: "low" | "medium" | "high";
  onThinkingEffortChange: (effort: "low" | "medium" | "high") => void | Promise<unknown>;
};

function messageImageSrc(m: ChatMessage): string | null {
  if (!m.imageDisplayPath) return null;
  if (m.imageDisplayPath.startsWith("blob:")) return m.imageDisplayPath;
  try {
    return convertFileSrc(m.imageDisplayPath);
  } catch {
    return m.imageDisplayPath;
  }
}

/** During streaming, hide in-progress ```artifact blocks only (keep code fences visible). */
function streamingAssistantDisplay(text: string): string {
  const match = /```artifact\b/i.exec(text);
  if (!match || match.index < 0) return text;
  const before = text.slice(0, match.index).trimEnd();
  if (before) return `${before}\n\n(Preparing report…)`;
  return "(Preparing report…)";
}







export function ChatMain({
  title,
  subtitle,
  hasActiveConversation,
  messages,
  threadLoading,
  sending,
  streamAssistant,
  error,
  recipes,
  onRunRecipe,
  onSubmitArtifactForm,
  projectList,
  activeProjectId,
  onContinueProject,
  onOpenProjectWorkspace,
  settingsLayoutMode,
  onCycleSettingsLayout,
  onSendMessage,
  onAbortTurn,
  visionSupported,
  activeCompanionProfileId,
  activeCompanionLabel,
  companionOptions,
  onCompanionChange,
  thinkingEffort,
  onThinkingEffortChange,
}: Props) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachMenuRef = useRef<HTMLDivElement | null>(null);
  const [draft, setDraft] = useState("");
  const [pendingImage, setPendingImage] = useState<PendingComposerImage | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);
  const [webcamOpen, setWebcamOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [moltbookOpen, setMoltbookOpen] = useState(false);
  const [moltbookReady, setMoltbookReady] = useState(false);

  useEffect(() => {
    invoke<{ enabled: boolean; hasApiKey: boolean }>("moltbook_status")
      .then((s) => {
        setMoltbookReady(s.enabled && s.hasApiKey);
      })
      .catch(() => setMoltbookReady(false));
  }, [settingsLayoutMode]);

  useEffect(() => {
    const el = scrollAreaRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, threadLoading, streamAssistant, pendingImage]);

  const clearPendingImage = () => {
    setPendingImage((prev) => {
      if (prev?.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(prev.previewUrl);
      }
      return null;
    });
  };

  const canSend =
    hasActiveConversation &&
    !threadLoading &&
    !sending &&
    (draft.trim().length > 0 || pendingImage != null);

  const submit = () => {
    if (!canSend || sending) return;
    onSendMessage(draft, pendingImage);
    setDraft("");
    clearPendingImage();
  };

  const canRunRecipe = hasActiveConversation && !threadLoading && !sending;
  const canSubmitForm = hasActiveConversation && !threadLoading && !sending;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onPickImage = async (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    try {
      setAttachError(null);
      const { base64, mime } = await readImageFileAsDataUrl(file);
      const previewUrl = URL.createObjectURL(file);
      setPendingImage((prev) => {
        if (prev?.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(prev.previewUrl);
        }
        return { file, previewUrl, base64, mime };
      });
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e));
    }
  };

  const onWebcamCapture = async (blob: Blob) => {
    const file = fileFromImageBlob(blob);
    await onPickImage(file);
  };

  useEffect(() => {
    if (!attachMenuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!attachMenuRef.current?.contains(event.target as Node)) {
        setAttachMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [attachMenuOpen]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-gradient-to-b from-slate-100 dark:from-slate-950 via-slate-100 dark:via-slate-950 to-slate-200 dark:to-slate-900/80">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200 dark:border-slate-800/80 px-4 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Sparkles className="size-4 shrink-0 text-indigo-400" aria-hidden />
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{title}</h1>
            <p className="truncate text-xs text-slate-500" title={subtitle}>
              {subtitle}
            </p>
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/60 px-2.5 py-1.5"
          title="Reasoning effort for providers that support thinking modes"
        >
          <Brain className="size-4 shrink-0 text-slate-500 dark:text-slate-400" aria-hidden />
          <label htmlFor="persistent-sage-thinking" className="sr-only">
            Thinking effort
          </label>
          <select
            id="persistent-sage-thinking"
            value={thinkingEffort}
            disabled={threadLoading || sending}
            onChange={(e) => void onThinkingEffortChange(e.target.value as "low" | "medium" | "high")}
            className="h-9 appearance-none rounded-lg border border-transparent bg-transparent py-1.5 pl-1 pr-1 text-xs font-semibold text-slate-700 dark:text-slate-200 outline-none transition hover:text-slate-900 dark:hover:text-white focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:opacity-50"
          >
            <option value="low">Think low</option>
            <option value="medium">Think medium</option>
            <option value="high">Think high</option>
          </select>
        </div>
        <div
          className="flex shrink-0 items-center gap-2 rounded-xl border border-indigo-500/35 bg-indigo-50 dark:bg-indigo-950/40 px-2.5 py-1.5 shadow-inner shadow-indigo-200/50 dark:shadow-indigo-950/30"
          title={`Active companion: ${activeCompanionLabel}. Choose who to talk to before starting a new chat.`}
        >
          <Users className="size-4 shrink-0 text-indigo-300" aria-hidden />
          <div className="relative">
            <label htmlFor="nova-header-companion" className="sr-only">
              Companion for new chats
            </label>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-indigo-300/80"
              aria-hidden
            />
            <select
              id="nova-header-companion"
              value={activeCompanionProfileId}
              onChange={async (e) => {
                const next = e.target.value;
                console.info("[persistent-sage-chat] companion dropdown: user selected personality_id", {
                  personalityId: next,
                  previousPersonalityId: activeCompanionProfileId,
                });
                await onCompanionChange(next);
                console.info("[persistent-sage-chat] companion dropdown: handler finished for personality_id", {
                  personalityId: next,
                });
              }}
              disabled={threadLoading || sending}
              className="h-9 max-w-[min(18rem,calc(100vw-12rem))] min-w-[11rem] appearance-none rounded-lg border border-indigo-400/40 bg-white/95 dark:bg-slate-950/90 py-1.5 pl-2.5 pr-8 text-xs font-semibold text-slate-900 dark:text-white outline-none transition hover:border-indigo-400/60 focus-visible:border-indigo-400 focus-visible:ring-2 focus-visible:ring-indigo-500/30 disabled:opacity-50"
              title="This companion receives new chats and uses their isolated memory. Disabled while a reply is in progress."
            >
              {companionOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.companionName}
                  {o.profileName && o.profileName !== o.companionName
                    ? ` · ${o.profileName}`
                    : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setFavoritesOpen(true)}
          title="Favorites — messages you starred"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 shadow-sm transition hover:bg-slate-200 dark:hover:bg-slate-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          <Star className="size-4 text-amber-400" aria-hidden />
          Favorites
        </button>
        {moltbookReady ? (
          <button
            type="button"
            onClick={() => setMoltbookOpen(true)}
            title="Browse Moltbook — the social network for AI agents"
            className="inline-flex items-center gap-2 rounded-lg border border-[#2a6b6e]/60 bg-[#0d383c]/90 px-3 py-1.5 text-xs font-semibold text-[#b8e6e2] shadow-sm transition hover:border-[#e86d4a]/50 hover:bg-[#13484c] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#e86d4a]"
          >
            <Globe className="size-4 text-[#e86d4a]" aria-hidden />
            Moltbook
          </button>
        ) : null}
        <button
          type="button"
          onClick={onCycleSettingsLayout}
          aria-expanded={settingsLayoutMode !== "hidden"}
          aria-controls="nova-settings-panel"
          title={`Settings: ${settingsLayoutLabel(settingsLayoutMode)} — click to cycle Hidden → Compact → Full`}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 shadow-sm transition hover:border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          <PanelRightOpen className="size-4 text-slate-600 dark:text-slate-400" aria-hidden />
          {settingsLayoutMode === "hidden"
            ? "Settings"
            : `Settings · ${settingsLayoutLabel(settingsLayoutMode)}`}
        </button>
      </header>

      {error || attachError ? (
        <div
          role="alert"
          className="shrink-0 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-200"
        >
          {error ?? attachError}
        </div>
      ) : null}

      <div
        ref={scrollAreaRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-4 py-4"
      >
        {threadLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80 dark:bg-slate-950/70 backdrop-blur-[2px]">
            <Loader2
              className="size-8 animate-spin text-indigo-400"
              aria-hidden
            />
            <p className="text-sm text-slate-600 dark:text-slate-400">Loading history & context…</p>
          </div>
        ) : null}
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && !threadLoading ? (
            <p className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800/90 bg-slate-50 dark:bg-slate-900/30 px-4 py-8 text-center text-sm text-slate-500">
              {hasActiveConversation ? (
                <>
                  No messages in this conversation yet. Say hello below — everything
                  stays in your local SQLite store.
                </>
              ) : (
                <>
                  No chat thread is open. Click <strong className="text-slate-700 dark:text-slate-300">New chat</strong>{" "}
                  in the sidebar to create one — your threads live in local SQLite (not in the git
                  repo), so a new machine starts empty until you add a chat.
                </>
              )}
            </p>
          ) : (
            messages.map((m) => (
              <article
                key={m.id}
                className={
                  m.role === "user"
                    ? "group ml-8 rounded-2xl rounded-br-md border border-slate-200 dark:border-slate-800/80 bg-slate-100 dark:bg-slate-900/70 px-4 py-3 text-sm leading-relaxed text-slate-900 dark:text-slate-100 shadow-sm"
                    : "group mr-8 rounded-2xl rounded-bl-md border border-indigo-500/20 bg-indigo-500/10 px-4 py-3 text-sm leading-relaxed text-slate-900 dark:text-slate-100 shadow-sm"
                }
              >
                <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {formatChatHeader(
                    m.role === "user" ? "You" : activeCompanionLabel,
                    m.createdAt,
                  )}
                </p>
                {messageImageSrc(m) ? (
                  <img
                    src={messageImageSrc(m)!}
                    alt=""
                    className="mb-2 max-h-64 max-w-full rounded-lg border border-slate-300 dark:border-slate-700/80 object-contain"
                  />
                ) : null}
                {m.role === "assistant" && m.artifactJson ? (
                      <ArtifactRenderer
                        artifactJson={m.artifactJson}
                        disabled={!canSubmitForm}
                        companionName={activeCompanionLabel}
                        onSubmitArtifactForm={onSubmitArtifactForm}
                      />
                    ) : null}
                    {m.content ? (
                  <MessageContent text={m.content} />
                ) : null}
                {m.content ? (
                  <MessageActions
                    messageId={m.id}
                    content={m.content}
                    favorite={m.favorite}
                  />
                ) : null}
              </article>
            ))
          )}
          {streamAssistant ? (
            <article className="mr-8 rounded-2xl rounded-bl-md border border-indigo-500/30 bg-indigo-500/10 px-4 py-3 text-sm leading-relaxed text-slate-900 dark:text-slate-100 shadow-sm">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                {formatChatHeader("Agent", new Date().toISOString())}
              </p>
              {streamAssistant.thinking && !streamAssistant.text ? (
                <p className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
                  <Loader2 className="size-4 shrink-0 animate-spin text-indigo-400" aria-hidden />
                  <span>Thinking…</span>
                </p>
              ) : (
                <div className="text-slate-900 dark:text-slate-100">
                  <MessageContent text={streamingAssistantDisplay(streamAssistant.text)} />
                </div>
              )}
            </article>
          ) : null}
          <div aria-hidden className="h-px shrink-0" />
        </div>
      </div>

      <footer className="shrink-0 border-t border-slate-200 dark:border-slate-800/80 p-4">
        <form
          onSubmit={handleSubmit}
          className="mx-auto flex max-w-3xl flex-col gap-2"
        >
          {projectList.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                Projects
              </span>
              {projectList.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!canRunRecipe}
                  onClick={() => onContinueProject(p.id, p.title)}
                  title={`Continue ${p.title}`}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${
                    p.id === activeProjectId
                      ? "border-indigo-500/50 bg-indigo-500/15 text-indigo-800 dark:text-indigo-200"
                      : "border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-slate-950/30 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900"
                  }`}
                >
                  {p.title}
                </button>
              ))}
              <button
                type="button"
                onClick={onOpenProjectWorkspace}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-800/80 px-2.5 py-1 text-[10px] font-medium text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-900"
              >
                <FolderOpen className="size-3" aria-hidden />
                Workspace
              </button>
            </div>
          ) : null}
          {recipes.length ? (
            <div className="flex flex-wrap gap-2">
              {recipes.slice(0, 4).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  disabled={!canRunRecipe}
                  onClick={() => onRunRecipe(r.id)}
                  title={r.description || r.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-slate-950/30 px-3 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="size-3 text-indigo-400" aria-hidden />
                  {r.name}
                </button>
              ))}
            </div>
          ) : null}
          {pendingImage ? (
            <div className="relative inline-flex w-fit max-w-full items-start gap-2 rounded-xl border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/60 p-2">
              <img
                src={pendingImage.previewUrl}
                alt="Attached"
                className="max-h-24 max-w-full rounded-lg object-contain"
              />
              <button
                type="button"
                onClick={clearPendingImage}
                className="absolute -right-2 -top-2 rounded-full border border-slate-300 dark:border-slate-600 bg-slate-200 dark:bg-slate-800 p-0.5 text-slate-700 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-700"
                aria-label="Remove attached image"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          <div className="flex gap-2">
          <div className="relative" ref={attachMenuRef}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              void onPickImage(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
          {attachMenuOpen ? (
            <div
              role="menu"
              className="absolute bottom-full left-0 z-20 mb-1 min-w-[11rem] overflow-hidden rounded-lg border border-slate-300 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-900"
            >
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => {
                  setAttachMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <ImagePlus className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                Choose from computer
              </button>
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                onClick={() => {
                  setAttachMenuOpen(false);
                  setWebcamOpen(true);
                }}
              >
                <Camera className="size-3.5 shrink-0 text-slate-500" aria-hidden />
                Take photo with webcam
              </button>
            </div>
          ) : null}
          <button
            type="button"
            disabled={threadLoading || sending || !hasActiveConversation || !visionSupported}
            onClick={() => setAttachMenuOpen((open) => !open)}
            title={
              visionSupported
                ? "Attach image"
                : "Current model does not support images — switch to a vision model in Settings → Provider (e.g. gpt-4o, Claude 3+, llava, kimi)."
            }
            className="inline-flex shrink-0 items-center justify-center self-end rounded-xl border border-slate-300 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-900/60 px-3 py-2 text-slate-700 dark:text-slate-300 transition hover:border-slate-300 dark:border-slate-600 hover:bg-slate-200 dark:bg-slate-800/80 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Attach image"
            aria-haspopup="menu"
            aria-expanded={attachMenuOpen}
          >
            <ImagePlus className="size-4" aria-hidden />
          </button>
          </div>
          <label className="sr-only" htmlFor="nova-composer">
            Message
          </label>
          <textarea
            id="nova-composer"
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                submit();
              }
            }}
            disabled={threadLoading || sending || !hasActiveConversation}
            placeholder={
              hasActiveConversation
                ? `Message ${activeCompanionLabel}…`
                : 'Click "New chat" in the sidebar first…'
            }
            className="min-h-[2.75rem] flex-1 resize-none rounded-xl border border-slate-200 dark:border-slate-800/90 bg-slate-100 dark:bg-slate-900/60 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-600 shadow-inner outline-none ring-0 transition focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => onAbortTurn?.()}
            disabled={!sending}
            title="Abort the current agent turn"
            className="inline-flex shrink-0 items-center justify-center gap-2 self-end rounded-xl border border-red-400/50 bg-red-500/20 px-3 py-2 text-red-700 shadow-sm transition hover:bg-red-500/30 disabled:pointer-events-none disabled:opacity-30 dark:text-red-200"
            aria-label="Abort turn"
          >
            <OctagonX className="size-4" aria-hidden />
          </button>
          <button
            type="submit"
            disabled={!canSend}
            className="inline-flex shrink-0 items-center justify-center gap-2 self-end rounded-xl bg-indigo-500 px-3 py-2 text-slate-900 dark:text-white shadow-sm shadow-indigo-500/25 transition hover:bg-indigo-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 disabled:pointer-events-none disabled:opacity-40"
            aria-label="Send message"
          >
            {sending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Send className="size-4" aria-hidden />
            )}
          </button>
          </div>
        </form>
      </footer>
      <WebcamCaptureModal
        open={webcamOpen}
        onClose={() => setWebcamOpen(false)}
        onCapture={(blob) => void onWebcamCapture(blob)}
      />
      <FavoritesPanel open={favoritesOpen} onClose={() => setFavoritesOpen(false)} />
      <MoltbookPanel open={moltbookOpen} onClose={() => setMoltbookOpen(false)} />
    </section>
  );
}
