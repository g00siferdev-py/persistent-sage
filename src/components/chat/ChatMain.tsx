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
  Star,
  X,
} from "lucide-react";
import type { ChatMessage } from "@/types/chat";
import type { StreamAssistantState } from "@/hooks/useChat";
import { fileFromImageBlob, readImageFileAsDataUrl } from "@/lib/chatAttachments";
import { pickWorkspaceImage } from "@/lib/pickWorkspaceImage";
import { settingsLayoutLabel, type SettingsLayoutMode } from "@/lib/settingsLayout";
import { formatChatHeader } from "@/lib/chatTimestamp";
import { ArtifactRenderer } from "@/components/chat/ArtifactRenderer";
import { FavoritesPanel } from "@/components/chat/FavoritesPanel";
import { MessageActions } from "@/components/chat/MessageActions";
import { MessageContent } from "@/components/chat/MessageContent";
import { MoltbookPanel } from "@/components/chat/MoltbookPanel";
import { WebcamCaptureModal } from "@/components/chat/WebcamCaptureModal";
import { ToolActivityPanel } from "@/components/coding/ToolActivityPanel";
import { toolDisplayName } from "@/lib/toolDisplayNames";

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

  const onPickFromWorkspace = async () => {
    try {
      setAttachError(null);
      const picked = await pickWorkspaceImage();
      if (!picked) return;
      const file = new File([], picked.fileName, { type: picked.mime });
      setPendingImage((prev) => {
        if (prev?.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(prev.previewUrl);
        }
        return {
          file,
          previewUrl: picked.base64,
          base64: picked.base64,
          mime: picked.mime,
        };
      });
    } catch (e) {
      setAttachError(e instanceof Error ? e.message : String(e));
    }
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
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ps-surface/70">
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-ps-border bg-ps-elevated/60 px-6 py-2.5">
        <div className="flex min-w-0 items-baseline gap-3">
          <h1 className="font-display truncate text-base font-semibold tracking-tight text-ps-ink">
            {title}
          </h1>
          <p className="hidden min-w-0 truncate text-xs text-ps-faint md:block" title={subtitle}>
            {subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="relative" title={`Active companion: ${activeCompanionLabel}. Choose who to talk to before starting a new chat.`}>
            <label htmlFor="nova-header-companion" className="sr-only">
              Companion for new chats
            </label>
            <ChevronDown
              className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-ps-faint"
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
              disabled={threadLoading}
              className="ps-select h-8 max-w-[14rem] min-w-[9rem] py-1 pl-2.5 pr-8"
              title="This companion receives new chats and uses their isolated memory"
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
          <button type="button" onClick={() => setFavoritesOpen(true)} title="Favorites — messages you starred" className="ps-btn-ghost">
            <Star className="size-3.5 text-ps-warm" aria-hidden />
            <span className="hidden lg:inline">Favorites</span>
          </button>
          {moltbookReady ? (
            <button
              type="button"
              onClick={() => setMoltbookOpen(true)}
              title="Browse Moltbook — the social network for AI agents"
              className="ps-btn-ghost"
            >
              <Globe className="size-3.5 text-ps-warm" aria-hidden />
              <span className="hidden lg:inline">Moltbook</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onCycleSettingsLayout}
            aria-expanded={settingsLayoutMode !== "hidden"}
            aria-controls="nova-settings-panel"
            title={`Settings: ${settingsLayoutLabel(settingsLayoutMode)} — click to cycle Hidden → Compact → Full`}
            className="ps-btn-ghost"
          >
            <PanelRightOpen className="size-3.5" aria-hidden />
            <span className="hidden lg:inline">
              {settingsLayoutMode === "hidden"
                ? "Settings"
                : `Settings · ${settingsLayoutLabel(settingsLayoutMode)}`}
            </span>
          </button>
        </div>
      </header>

      {error || attachError ? (
        <div
          role="alert"
          className="shrink-0 border-b border-ps-warm/40 bg-ps-warm-soft px-5 py-2.5 text-xs text-ps-ink"
        >
          {error ?? attachError}
        </div>
      ) : null}

      <div
        ref={scrollAreaRef}
        className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-6 sm:px-10"
      >
        {threadLoading ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/80 dark:bg-ps-canvas backdrop-blur-[2px]">
            <Loader2
              className="size-8 animate-spin text-ps-accent"
              aria-hidden
            />
            <p className="text-sm text-ps-muted">Loading history & context…</p>
          </div>
        ) : null}
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {messages.length === 0 && !threadLoading ? (
            <p className="border border-dashed border-ps-border bg-ps-elevated px-6 py-12 text-left text-sm leading-relaxed text-ps-muted">
              {hasActiveConversation ? (
                <>
                  No messages in this conversation yet. Say hello below — everything
                  stays in your local SQLite store.
                </>
              ) : (
                <>
                  No chat thread is open. Click <strong className="text-ps-muted">New chat</strong>{" "}
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
                    ? "group ps-msg-user"
                    : "group ps-msg-assistant"
                }
              >
                <p className="ps-msg-label">
                  {formatChatHeader(
                    m.role === "user" ? "You" : activeCompanionLabel,
                    m.createdAt,
                  )}
                </p>
                {messageImageSrc(m) ? (
                  <img
                    src={messageImageSrc(m)!}
                    alt=""
                    className="mb-2 max-h-64 max-w-full rounded-lg border border-ps-border object-contain"
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
            <article className="ps-msg-assistant">
              <p className="ps-msg-label">
                {formatChatHeader("Agent", new Date().toISOString())}
              </p>
              {streamAssistant.toolActivity ? (
                <div className="mb-2">
                  <ToolActivityPanel activity={streamAssistant.toolActivity} />
                </div>
              ) : null}
              {streamAssistant.thinking && !streamAssistant.text ? (
                <p className="flex items-center gap-2 text-ps-muted">
                  <Loader2 className="size-4 shrink-0 animate-spin text-ps-accent" aria-hidden />
                  <span>
                    {streamAssistant.statusDetail?.trim()
                      ? streamAssistant.statusDetail
                      : streamAssistant.toolActivity?.running
                        ? `${toolDisplayName(streamAssistant.toolActivity.toolName)}…`
                        : "Thinking…"}
                  </span>
                </p>
              ) : (
                <div className="text-ps-ink">
                  <MessageContent text={streamingAssistantDisplay(streamAssistant.text)} />
                </div>
              )}
            </article>
          ) : null}
          <div aria-hidden className="h-px shrink-0" />
        </div>
      </div>

      <footer className="shrink-0 border-t border-ps-border bg-ps-elevated/60 px-6 pb-5 pt-4">
        <form onSubmit={handleSubmit} className="mx-auto flex w-full max-w-3xl flex-col gap-3">
          {projectList.length ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="ps-label">Projects</span>
              {projectList.slice(0, 6).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!canRunRecipe}
                  onClick={() => onContinueProject(p.id, p.title)}
                  title={`Continue ${p.title}`}
                  className={`ps-chip ${p.id === activeProjectId ? "ps-chip-active" : ""}`}
                >
                  {p.title}
                </button>
              ))}
              <button type="button" onClick={onOpenProjectWorkspace} className="ps-chip">
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
                  className="ps-chip"
                >
                  {r.name}
                </button>
              ))}
            </div>
          ) : null}
          {pendingImage ? (
            <div className="relative inline-flex w-fit max-w-full items-start gap-2 border border-ps-border bg-ps-surface p-2" style={{ borderRadius: "var(--ps-radius)" }}>
              <img
                src={pendingImage.previewUrl}
                alt="Attached"
                className="max-h-24 max-w-full object-contain"
              />
              <button
                type="button"
                onClick={clearPendingImage}
                className="absolute -right-2 -top-2 rounded-md border border-ps-border bg-ps-elevated p-0.5 text-ps-muted hover:bg-ps-accent-soft"
                aria-label="Remove attached image"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </div>
          ) : null}
          <div className="ps-composer-box">
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
              className="min-h-[3.25rem] w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm text-ps-ink outline-none placeholder:text-ps-faint disabled:opacity-50"
            />
            <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-1">
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
                  <div role="menu" className="ps-menu absolute bottom-full left-0 z-20 mb-1 min-w-[11rem]">
                    <button
                      type="button"
                      role="menuitem"
                      className="ps-menu-item"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        fileInputRef.current?.click();
                      }}
                    >
                      <ImagePlus className="size-3.5 shrink-0 text-ps-faint" aria-hidden />
                      Choose from computer
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="ps-menu-item"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        void onPickFromWorkspace();
                      }}
                    >
                      <FolderOpen className="size-3.5 shrink-0 text-ps-faint" aria-hidden />
                      From workspace
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="ps-menu-item"
                      onClick={() => {
                        setAttachMenuOpen(false);
                        setWebcamOpen(true);
                      }}
                    >
                      <Camera className="size-3.5 shrink-0 text-ps-faint" aria-hidden />
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
                  className="ps-btn-ghost p-2 disabled:pointer-events-none disabled:opacity-40"
                  aria-label="Attach image"
                  aria-haspopup="menu"
                  aria-expanded={attachMenuOpen}
                >
                  <ImagePlus className="size-4" aria-hidden />
                </button>
              </div>
              <div className="relative" title="Reasoning effort for providers that support thinking modes">
                <Brain className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-ps-faint" aria-hidden />
                <label htmlFor="persistent-sage-thinking" className="sr-only">
                  Thinking effort
                </label>
                <select
                  id="persistent-sage-thinking"
                  value={thinkingEffort}
                  disabled={threadLoading || sending}
                  onChange={(e) => void onThinkingEffortChange(e.target.value as "low" | "medium" | "high")}
                  className="ps-select h-8 py-1 pl-7 pr-2 text-[11px]"
                >
                  <option value="low">Think low</option>
                  <option value="medium">Think medium</option>
                  <option value="high">Think high</option>
                </select>
              </div>
              <span className="ml-auto hidden text-[10px] text-ps-faint sm:inline">
                Enter to send · Shift+Enter for newline
              </span>
              <button
                type="button"
                onClick={() => onAbortTurn?.()}
                disabled={!sending}
                title="Abort the current agent turn"
                className="ps-btn-danger px-2.5 py-1.5"
                aria-label="Abort turn"
              >
                <OctagonX className="size-4" aria-hidden />
              </button>
              <button
                type="submit"
                disabled={!canSend}
                className="ps-btn-primary px-3.5 py-1.5"
                aria-label="Send message"
              >
                {sending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Send className="size-4" aria-hidden />
                )}
                Send
              </button>
            </div>
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
