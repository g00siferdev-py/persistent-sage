import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ChatMessage,
  ChatSendResult,
  StoredAnchor,
  StoredConversation,
} from "@/types/chat";
import { getStoredTheme } from "@/lib/theme";
import { storedToChatMessage } from "@/types/chat";
import {
  memoryCreateConversation,
  memoryDeleteConversation,
  memoryExtractAnchorsFromConversation,
  memoryGetRecent,
  memoryListAnchors,
  memoryListConversations,
  memoryRenameConversation,
  memorySetActivePersonality,
  memoryStartupBriefing,
} from "@/hooks/useNovaMemory";
import type { PersonalityFile } from "@/lib/personalityPrompt";
import {
  applyToolStreamEvent,
  type ChatToolStreamEvent,
  type ToolActivityState,
} from "@/types/toolStream";

const RECENT_LIMIT = 200;

type PersonalityGetResponse = {
  file: PersonalityFile;
  generatedSystemPrompt: string;
};

function companionDisplayName(file: PersonalityFile | null, profileId: string): string {
  if (!file?.profiles?.length) return "Sage";
  const p = file.profiles.find((x) => x.id === profileId);
  if (!p) return "Sage";
  const n = p.companionName.trim();
  return n.length > 0 ? n : "Sage";
}

export type StreamAssistantState = {
  thinking: boolean;
  text: string;
  statusDetail: string | null;
  toolActivity: ToolActivityState;
} | null;

export function useChat(options?: {
  externalActiveConversationId?: string | null;
  onActiveConversationIdChange?: (id: string | null) => void;
}) {
  const externalId = options?.externalActiveConversationId ?? null;
  const onExternalChange = options?.onActiveConversationIdChange;

  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeConversationId, setInternalActiveConversationId] = useState<string | null>(
    externalId,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [briefing, setBriefing] = useState<string>("");
  const [anchors, setAnchors] = useState<StoredAnchor[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [extractingAnchors, setExtractingAnchors] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamAssistant, setStreamAssistant] = useState<StreamAssistantState>(null);
  const [error, setError] = useState<string | null>(null);
  /** Companion profile id — MemoryAnchor is scoped to this for chats, recall, and threads. */
  const [activePersonalityId, setActivePersonalityId] = useState("default");
  /** Last `personality_get` snapshot — used for companion labels and header dropdown. */
  const [personalityFile, setPersonalityFile] = useState<PersonalityFile | null>(null);
  /** When true, the sidebar shows no threads and the main pane has no selection — SQLite is unchanged. */
  const [threadListHiddenFromSidebar, setThreadListHiddenFromSidebar] = useState(false);
  const [visionSupported, setVisionSupported] = useState(false);
  const [recipes, setRecipes] = useState<
    { id: string; name: string; description?: string; requiresBrowserFetch?: boolean }[]
  >([]);
  const [projectList, setProjectList] = useState<
    { id: string; title: string; kind?: string }[]
  >([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);
  /** True while `chat_send_message` is in flight — mirrors coding mode to avoid stream `done` clearing the bubble early. */
  const sendingRef = useRef(false);
  /** Abort flag readable after await (state alone is stale inside the in-flight send). */
  const abortedTurnRef = useRef(false);
  /** Mirrors `activePersonalityId` for invoke payloads (always read right before IPC). */
  const activePersonalityIdRef = useRef(activePersonalityId);

  // Keep internal state in sync with the external (lifted) state when it changes.
  useEffect(() => {
    setInternalActiveConversationId(externalId);
  }, [externalId]);

  const setActiveConversationId = useCallback(
    (
      next: string | null | ((prev: string | null) => string | null),
    ) => {
      const resolved = typeof next === "function" ? next(activeConversationIdRef.current) : next;
      setInternalActiveConversationId(resolved);
      onExternalChange?.(resolved);
    },
    [onExternalChange],
  );

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    activePersonalityIdRef.current = activePersonalityId;
  }, [activePersonalityId]);

  const refreshVisionSupported = useCallback(async () => {
    try {
      const ok = await invoke<boolean>("chat_vision_supported");
      setVisionSupported(ok);
    } catch {
      setVisionSupported(false);
    }
  }, []);

  const refreshRecipes = useCallback(async () => {
    try {
      const list = await invoke<
        { id: string; name: string; description?: string; requiresBrowserFetch?: boolean }[]
      >("recipe_list");
      setRecipes(list ?? []);
    } catch {
      setRecipes([]);
    }
  }, []);

  const refreshProjectList = useCallback(async () => {
    try {
      const view = await invoke<{
        projects: { id: string; title: string; kind?: string }[];
        activeProjectId?: string | null;
      }>("project_list");
      setProjectList(view.projects ?? []);
      setActiveProjectId(view.activeProjectId?.trim() || null);
    } catch {
      setProjectList([]);
      setActiveProjectId(null);
    }
  }, []);

  const refreshConversations = useCallback(async () => {
    try {
      const list = await memoryListConversations();
      setConversations(list);
      setError(null);
      return list;
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "Could not load conversations. Run the desktop app with: npm run tauri dev (browser-only preview has no Rust backend).";
      setError(msg);
      return [];
    }
  }, []);

  const loadActiveThread = useCallback(async (conversationId: string) => {
    const seq = ++loadSeq.current;
    setThreadLoading(true);
    setError(null);
    let messagesLoaded = false;
    try {
      const recent = await memoryGetRecent(conversationId, RECENT_LIMIT);
      if (seq !== loadSeq.current) return;
      setMessages(recent.map(storedToChatMessage));
      messagesLoaded = true;

      try {
        const [brief, anchorList] = await Promise.all([
          memoryStartupBriefing(conversationId),
          memoryListAnchors(conversationId, 48),
        ]);
        if (seq !== loadSeq.current) return;
        setBriefing(brief);
        setAnchors(anchorList);
      } catch (sidebarErr) {
        if (seq !== loadSeq.current) return;
        const sidebarMsg =
          sidebarErr instanceof Error
            ? sidebarErr.message
            : "Could not load memory sidebar.";
        setError(`Could not refresh memory sidebar: ${sidebarMsg}`);
        setBriefing("");
        setAnchors([]);
      }
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const msg =
        e instanceof Error
          ? e.message
          : "Could not load chat history. Use npm run tauri dev for the full app.";
      if (!messagesLoaded) {
        setError(msg);
        setMessages([]);
        setBriefing("");
        setAnchors([]);
      }
    } finally {
      // Always clear: a newer `loadSeq` (e.g. from an in-flight send) may have invalidated this load
      // while it still held threadLoading true.
      setThreadLoading(false);
    }
  }, []);

  /** Pulse uses the open thread — same session as manual sends (stored in settings.json). */
  useEffect(() => {
    void invoke("settings_update", {
      patch: { pulseConversationId: activeConversationId },
    }).catch(() => {
      /* browser / no backend */
    });
  }, [activeConversationId]);

  /** Stream events for manual sends on the active thread (Pulse does not stream into chat). */
  useEffect(() => {
    let unlistenStart: (() => void) | undefined;
    let unlistenStream: (() => void) | undefined;
    let unlistenTool: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    let unlistenErr: (() => void) | undefined;
    let unlistenPulse: (() => void) | undefined;
    let unlistenEmail: (() => void) | undefined;

    type ChatTurnStatusEvent = {
      conversationId: string;
      detail: string;
    };

    void listen<{ conversationId: string }>("chat:stream-start", (e) => {
      if (e.payload.conversationId !== activeConversationIdRef.current) return;
      setStreamAssistant({
        thinking: true,
        text: "",
        statusDetail: "Preparing…",
        toolActivity: null,
      });
    }).then((fn) => {
      unlistenStart = fn;
    });

    void listen<{ conversationId: string; delta: string; done: boolean }>("chat:stream", (e) => {
      if (e.payload.conversationId !== activeConversationIdRef.current) return;
      const { delta, done } = e.payload;
      if (done) {
        // Synthetic stream `done` fires before invoke returns / transcript reload.
        // Clearing here ghosts the reply (especially after long workspace tool turns).
        if (sendingRef.current) return;
        setStreamAssistant(null);
        return;
      }
      if (delta) {
        setStreamAssistant((prev) => ({
          thinking: false,
          text: (prev?.text ?? "") + delta,
          statusDetail: prev?.statusDetail ?? null,
          toolActivity: prev?.toolActivity ?? null,
        }));
      }
    }).then((fn) => {
      unlistenStream = fn;
    });

    void listen<ChatToolStreamEvent>("chat:tool-stream", (e) => {
      if (e.payload.conversationId !== activeConversationIdRef.current) return;
      // Ignore stragglers after the turn finished — recreating an empty bubble looks like "Thinking…" forever.
      if (!sendingRef.current) return;
      setStreamAssistant((prev) => {
        const base = prev ?? {
          thinking: true,
          text: "",
          statusDetail: null,
          toolActivity: null,
        };
        const toolActivity = applyToolStreamEvent(base.toolActivity, e.payload);
        return {
          ...base,
          thinking: e.payload.phase === "start" ? true : base.thinking,
          statusDetail: e.payload.phase === "start" ? null : base.statusDetail,
          toolActivity,
        };
      });
    }).then((fn) => {
      unlistenTool = fn;
    });

    void listen<ChatTurnStatusEvent>("chat:turn-status", (e) => {
      if (e.payload.conversationId !== activeConversationIdRef.current) return;
      if (!sendingRef.current) return;
      setStreamAssistant((prev) => {
        const base = prev ?? {
          thinking: true,
          text: "",
          statusDetail: null,
          toolActivity: null,
        };
        // Keep tool panel visible while a tool is mid-flight; still refresh status text.
        const detail = e.payload.detail.trim();
        return {
          ...base,
          thinking: true,
          statusDetail: detail || base.statusDetail,
        };
      });
    }).then((fn) => {
      unlistenStatus = fn;
    });

    void listen<string>("chat:stream-error", (event) => {
      if (!activeConversationIdRef.current) return;
      setError(event.payload);
      setStreamAssistant(null);
    }).then((fn) => {
      unlistenErr = fn;
    });

    type PulseTickPayload = {
      ok: boolean;
      at: string;
      conversationId?: string;
      summary?: string;
      error?: string;
    };

    void listen<PulseTickPayload>("pulse:tick", (e) => {
      const cid = e.payload.conversationId;
      if (!cid || cid !== activeConversationIdRef.current) return;
      setStreamAssistant(null);
      if (e.payload.ok) {
        void loadActiveThread(cid);
      }
    }).then((fn) => {
      unlistenPulse = fn;
    });

    type AgentEmailWatchPayload = {
      ok: boolean;
      at: string;
      newCount?: number;
      conversationId?: string;
      summary?: string;
      error?: string;
    };

    void listen<AgentEmailWatchPayload>("agent-email:watch", (e) => {
      const cid = e.payload.conversationId;
      if (!cid || cid !== activeConversationIdRef.current) return;
      setStreamAssistant(null);
      if (e.payload.ok) {
        void loadActiveThread(cid);
      } else if (e.payload.error) {
        setError(e.payload.error);
      }
    }).then((fn) => {
      unlistenEmail = fn;
    });

    return () => {
      unlistenStart?.();
      unlistenStream?.();
      unlistenTool?.();
      unlistenStatus?.();
      unlistenErr?.();
      unlistenPulse?.();
      unlistenEmail?.();
    };
  }, [loadActiveThread]);

  /** Briefing + anchors only (e.g. after send) — does not replace `messages` or toggle thread loading. */
  const refreshSidebarContext = useCallback(async (conversationId: string) => {
    try {
      const [brief, anchorList] = await Promise.all([
        memoryStartupBriefing(conversationId),
        memoryListAnchors(conversationId, 48),
      ]);
      if (conversationId !== activeConversationIdRef.current) return;
      setBriefing(brief);
      setAnchors(anchorList);
    } catch {
      /* non-fatal: chat bubbles already updated locally */
    }
  }, []);

  const refreshPersonalityFile = useCallback(async () => {
    try {
      const snap = await invoke<PersonalityGetResponse>("personality_get");
      setPersonalityFile(snap.file);
    } catch {
      /* browser / no backend */
    }
  }, []);

  const applyActivePersonality = useCallback(
    async (personalityId: string) => {
      const id = personalityId.trim() || "default";
      setThreadListHiddenFromSidebar(false);
      try {
        console.info("[persistent-sage-chat] applyActivePersonality: awaiting memory_set_active_personality", {
          personalityId: id,
        });
        await memorySetActivePersonality(id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(`Could not activate companion for memory: ${msg}`);
        return [];
      }
      activePersonalityIdRef.current = id;
      loadSeq.current += 1;
      setActivePersonalityId(id);
      const list = await refreshConversations();
      setActiveConversationId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
      await refreshPersonalityFile();
      console.info("[persistent-sage-chat] applyActivePersonality: memory + UI active personality_id", {
        personalityId: id,
      });
      return list;
    },
    [refreshConversations, refreshPersonalityFile, setActiveConversationId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      setError(null);
      try {
        const snap = await invoke<PersonalityGetResponse>("personality_get");
        if (cancelled) return;
        setPersonalityFile(snap.file);
        const pid = snap.file.activeProfileId.trim() || "default";
        try {
          console.info("[persistent-sage-chat] bootstrap: awaiting memory_set_active_personality", {
            personalityId: pid,
          });
          await memorySetActivePersonality(pid);
        } catch {
          /* browser preview */
        }
        activePersonalityIdRef.current = pid;
        setActivePersonalityId(pid);
        const list = await refreshConversations();
        await refreshVisionSupported();
        await refreshRecipes();
        await refreshProjectList();
        if (cancelled) return;
        setListLoading(false);
        // If an external active conversation id was provided, keep it if it still exists.
        setActiveConversationId((prev) => {
          const target = prev ?? externalId;
          if (target && list.some((c) => c.id === target)) return target;
          return list[0]?.id ?? null;
        });
      } catch (e) {
        if (cancelled) return;
        const msg =
          e instanceof Error
            ? e.message
            : "Could not load conversations. Run the desktop app with: npm run tauri dev (browser-only preview has no Rust backend).";
        setError(msg);
        setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    refreshConversations,
    refreshVisionSupported,
    refreshRecipes,
    refreshProjectList,
    setActiveConversationId,
    externalId,
  ]);

  useEffect(() => {
    if (!activeConversationId) {
      setBriefing("");
      setAnchors([]);
      setMessages([]);
      return;
    }
    // Clear immediately so we never show the previous thread's bubbles while the new id loads
    // (avoids appending a send onto the wrong transcript).
    setBriefing("");
    setAnchors([]);
    setMessages([]);
    void loadActiveThread(activeConversationId);
  }, [activeConversationId, loadActiveThread]);

  const selectConversation = useCallback(
    (id: string) => {
      setThreadListHiddenFromSidebar(false);
      setActiveConversationId(id);
    },
    [setActiveConversationId],
  );

  /** Hides the conversation list and active thread in the UI only; does not call delete or touch the DB. */
  const clearConversationSidebarView = useCallback(() => {
    loadSeq.current += 1;
    setThreadListHiddenFromSidebar(true);
    setActiveConversationId(null);
    setBriefing("");
    setAnchors([]);
    setMessages([]);
    setError(null);
  }, [setActiveConversationId]);

  /** Reload threads from the database and show the list again. */
  const restoreConversationSidebarView = useCallback(async () => {
    setError(null);
    setThreadListHiddenFromSidebar(false);
    const list = await refreshConversations();
    if (list.length === 0) {
      setActiveConversationId(null);
      return;
    }
    setActiveConversationId((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev;
      return list[0]?.id ?? null;
    });
  }, [refreshConversations, setActiveConversationId]);

  const startNewConversation = useCallback(async () => {
    setError(null);
    setThreadListHiddenFromSidebar(false);
    const pid = activePersonalityIdRef.current.trim() || activePersonalityId.trim() || "default";
    try {
      console.info("[persistent-sage-chat] startNewConversation: awaiting memory_set_active_personality before create", {
        personalityId: pid,
      });
      await memorySetActivePersonality(pid);
      activePersonalityIdRef.current = pid;
      setActivePersonalityId(pid);
      const label = companionDisplayName(personalityFile, pid);
      const title = `New Chat with ${label}`;
      console.info("[persistent-sage-chat] startNewConversation: creating conversation", { personalityId: pid, title });
      const id = await memoryCreateConversation(title);
      await refreshConversations();
      setActiveConversationId(id);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not create conversation (run in Tauri?)";
      setError(msg);
    }
  }, [activePersonalityId, personalityFile, refreshConversations, setActiveConversationId]);

  const companionOptions = useMemo(() => {
    const base =
      personalityFile?.profiles?.map((p) => ({
        id: p.id,
        companionName: (p.companionName || "").trim() || "Sage",
        profileName: (p.profileName || "").trim() || p.id,
      })) ?? [];
    if (base.length === 0) {
      return [
        {
          id: activePersonalityId,
          companionName: companionDisplayName(personalityFile, activePersonalityId),
          profileName: "Default",
        },
      ];
    }
    if (!base.some((o) => o.id === activePersonalityId)) {
      return [
        ...base,
        {
          id: activePersonalityId,
          companionName: companionDisplayName(personalityFile, activePersonalityId),
          profileName: "Active",
        },
      ];
    }
    return base;
  }, [personalityFile, activePersonalityId]);

  const activeCompanionLabel = useMemo(
    () => companionDisplayName(personalityFile, activePersonalityId),
    [personalityFile, activePersonalityId],
  );

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) return;
      setError(null);
      try {
        await memoryRenameConversation(conversationId, trimmed);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === conversationId ? { ...c, title: trimmed } : c,
          ),
        );
        await refreshConversations();
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not rename conversation (run in Tauri?)";
        setError(msg);
      }
    },
    [refreshConversations],
  );

  const deleteConversation = useCallback(
    async (conversationId: string) => {
      setError(null);
      try {
        await memoryDeleteConversation(conversationId);
        setConversations((prev) => prev.filter((c) => c.id !== conversationId));
        const list = await refreshConversations();
        setActiveConversationId((prev) => {
          if (prev !== conversationId) return prev;
          if (list.length === 0) return null;
          return list[0]?.id ?? null;
        });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Could not delete conversation (run in Tauri?)";
        setError(msg);
        await refreshConversations();
      }
    },
    [refreshConversations, setActiveConversationId],
  );

  const extractAnchorsFromChat = useCallback(async () => {
    if (!activeConversationId || extractingAnchors) return;
    setError(null);
    setExtractingAnchors(true);
    try {
      await memoryExtractAnchorsFromConversation(activeConversationId, 12);
      await loadActiveThread(activeConversationId);
      await refreshConversations();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not extract anchors (run in Tauri?)";
      setError(msg);
    } finally {
      setExtractingAnchors(false);
    }
  }, [
    activeConversationId,
    extractingAnchors,
    loadActiveThread,
    refreshConversations,
  ]);

  const abortTurn = useCallback(() => {
    if (!sendingRef.current) return;
    abortedTurnRef.current = true;
    sendingRef.current = false;
    setStreamAssistant(null);
    setSending(false);
    setError("Turn aborted. The agent may still finish the current operation on the backend.");
  }, []);

  const sendMessage = useCallback(
    async (
      text: string,
      image?: { base64: string; mime: string; previewUrl?: string } | null,
      opts?: { silent?: boolean },
    ) => {
      const trimmed = text.trim();
      const convId = activeConversationId;
      if ((!trimmed && !image) || sendingRef.current) return;
      if (!convId) {
        setError(
          'No conversation is open. Click "New chat" in the sidebar (or restore your app data folder), then try again.',
        );
        return;
      }

      const silent = opts?.silent === true;
      if (!silent) {
        const tempUserId = `local-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          {
            id: tempUserId,
            role: "user",
            content: trimmed || "(photo)",
            createdAt: new Date().toISOString(),
            imageDisplayPath: image?.previewUrl,
            imageMime: image?.mime,
          },
        ]);
      }
      abortedTurnRef.current = false;
      setSending(true);
      sendingRef.current = true;
      setStreamAssistant({
        thinking: true,
        text: "",
        statusDetail: "Sending…",
        toolActivity: null,
      });
      setError(null);

      try {
        // Invalidate any `loadActiveThread` still awaiting IPC for this (often new) thread. Without
        // this, that load can finish with an empty `get_recent` while `chat_send_message` is still
        // running and then `setMessages([])` wipes the optimistic transcript ("chat disappeared").
        loadSeq.current += 1;

        const personalityIdForSend =
          activePersonalityIdRef.current.trim() || activePersonalityId.trim() || "default";
        console.info("[persistent-sage-chat] chat_send_message invoke", {
          personalityId: personalityIdForSend,
          conversationId: convId,
          hasImage: Boolean(image),
        });
        const result = await invoke<ChatSendResult>("chat_send_message", {
          conversationId: convId,
          message: trimmed,
          personalityId: personalityIdForSend,
          imageBase64: image?.base64 ?? null,
          imageMime: image?.mime ?? null,
          silentUserMessage: silent,
          uiTheme: getStoredTheme(),
        });

        // Paint invoke reply immediately so a stream/reload race can't leave an empty "Thinking…" bubble.
        // Then reload from SQLite so artifacts (artifactJson) render consistently.
        if (abortedTurnRef.current) {
          setStreamAssistant(null);
        } else {
          if (result.reply?.trim()) {
            setStreamAssistant({
              thinking: false,
              text: result.reply,
              statusDetail: null,
              toolActivity: null,
            });
          }
          await loadActiveThread(convId);
        }
        void refreshSidebarContext(convId);
        await refreshConversations();
        await refreshVisionSupported();
        await refreshProjectList();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Could not send message. Use npm run tauri dev (invoke + streaming require the Tauri shell).";
        setError(msg);
        await loadActiveThread(convId);
        await refreshConversations();
      } finally {
        sendingRef.current = false;
        setStreamAssistant(null);
        setSending(false);
        abortedTurnRef.current = false;
      }
    },
    [
      activeConversationId,
      activePersonalityId,
      loadActiveThread,
      refreshConversations,
      refreshSidebarContext,
      refreshProjectList,
      refreshVisionSupported,
    ],
  );

  const submitArtifactForm = useCallback(
    async (
      artifactTitle: string,
      projectId: string | undefined,
      values: Record<string, unknown>,
    ) => {
      try {
        const { message } = await invoke<{ message: string }>("project_format_form_submission", {
          artifactTitle,
          projectId: projectId ?? null,
          values,
        });
        await sendMessage(message, null, { silent: true });
        await refreshProjectList();
      } catch (e) {
        setError(String(e));
      }
    },
    [sendMessage, refreshProjectList],
  );

  const runRecipe = useCallback(
    async (recipeId: string) => {
      const convId = activeConversationIdRef.current;
      if (!convId) return;
      if (sendingRef.current) return;
      try {
        setSending(true);
        sendingRef.current = true;
        setError(null);
        await invoke("recipe_run", { recipeId, conversationId: convId });
        await loadActiveThread(convId);
        await refreshConversations();
        await refreshProjectList();
      } catch (e) {
        setError(String(e));
        await loadActiveThread(convId);
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [loadActiveThread, refreshConversations, refreshProjectList],
  );

  const continueProject = useCallback(
    (projectId: string, title: string) => {
      void sendMessage(
        `Please continue my project "${title}" (id: ${projectId}). Use project_read, update the document if needed, and show me a polished html artifact if there is a report to review.`,
        null,
      );
    },
    [sendMessage],
  );

  const openProjectWorkspace = useCallback(async () => {
    try {
      await invoke("open_path", { path: "workspace/projects" });
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const sidebarConversations = threadListHiddenFromSidebar ? [] : conversations;

  return {
    conversations: sidebarConversations,
    /** Full list from DB (ignores sidebar hide). For labels that need the active title after restore. */
    conversationsForTitle: conversations,
    threadListHiddenFromSidebar,
    clearConversationSidebarView,
    restoreConversationSidebarView,
    activeConversationId,
    activePersonalityId,
    activeCompanionLabel,
    companionOptions,
    messages,
    briefing,
    anchors,
    listLoading,
    threadLoading,
    extractingAnchors,
    sending,
    streamAssistant,
    error,
    selectConversation,
    startNewConversation,
    renameConversation,
    deleteConversation,
    extractAnchorsFromChat,
    sendMessage,
    visionSupported,
    refreshVisionSupported,
    recipes,
    refreshRecipes,
    runRecipe,
    submitArtifactForm,
    projectList,
    activeProjectId,
    continueProject,
    openProjectWorkspace,
    refreshProjectList,
    refreshConversations,
    applyActivePersonality,
    abortTurn,
  };
}
