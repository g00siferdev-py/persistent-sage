import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, ChatSendResult, StoredMessage } from "@/types/chat";
import { storedToChatMessage } from "@/types/chat";
import { memoryGetRecent, memorySetConversationCodingMeta } from "@/hooks/useNovaMemory";
import { getStoredTheme } from "@/lib/theme";
import { shouldApplyCodingTranscriptLoad } from "@/lib/codingTranscriptLoad";
import {
  applyToolStreamEvent,
  type ChatToolStreamEvent,
  type ToolActivityState,
} from "@/types/toolStream";

type ChatStreamStart = { conversationId: string };
type ChatStreamEvent = { conversationId: string; delta: string; done: boolean };

type ChatTurnStatusEvent = { conversationId: string; detail: string };

export type CodingStreamState = {
  thinking: boolean;
  text: string;
  statusDetail: string | null;
  toolActivity: ToolActivityState;
} | null;

type ActiveRepo = {
  id: string;
  name: string;
  pathRel: string;
};

type UseCodingChatOptions = {
  activeRepo: ActiveRepo | null;
  externalConversationId?: string | null;
  onConversationIdChange?: (id: string | null) => void;
};

export function useCodingChat({
  activeRepo,
  externalConversationId,
  onConversationIdChange,
}: UseCodingChatOptions) {
  const [conversationId, setInternalConversationId] = useState<string | null>(
    externalConversationId ?? null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamAssistant, setStreamAssistant] = useState<CodingStreamState>(null);
  const [abortedTurn, setAbortedTurn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(externalConversationId ?? null);
  const activeRepoIdRef = useRef<string | null>(activeRepo?.id ?? null);
  const sendingRef = useRef(false);
  const loadSeq = useRef(0);

  activeRepoIdRef.current = activeRepo?.id ?? null;

  useEffect(() => {
    conversationIdRef.current = externalConversationId ?? null;
    setInternalConversationId(externalConversationId ?? null);
  }, [externalConversationId]);

  const setConversationId = useCallback(
    (id: string | null) => {
      conversationIdRef.current = id;
      setInternalConversationId(id);
      onConversationIdChange?.(id);
    },
    [onConversationIdChange],
  );

  const setConversationIdInternal = useCallback((id: string | null) => {
    conversationIdRef.current = id;
    setInternalConversationId(id);
  }, []);

  const eventConversationMatches = useCallback((id: string) => {
    const active = conversationIdRef.current;
    return Boolean(active) && id === active;
  }, []);

  const loadStillCurrent = useCallback(
    (convId: string, repoId?: string | null) =>
      shouldApplyCodingTranscriptLoad({
        loadedConversationId: convId,
        loadedRepoId: repoId,
        activeConversationId: conversationIdRef.current,
        activeRepoId: activeRepoIdRef.current,
      }),
    [],
  );

  const loadMessages = useCallback(
    async (convId: string, options?: { silent?: boolean; repoId?: string | null }) => {
      const silent = options?.silent ?? false;
      if (!loadStillCurrent(convId, options?.repoId)) return;
      const seq = ++loadSeq.current;
      if (!silent) setLoading(true);
      try {
        const recent = await memoryGetRecent(convId, 200);
        if (seq !== loadSeq.current) return;
        if (!loadStillCurrent(convId, options?.repoId)) return;
        setMessages(recent.map(storedToChatMessage));
        setError(null);
      } catch (e) {
        if (seq !== loadSeq.current) return;
        if (!loadStillCurrent(convId, options?.repoId)) return;
        setError(e instanceof Error ? e.message : String(e));
        if (!silent) setMessages([]);
      } finally {
        if (seq === loadSeq.current && !silent) setLoading(false);
      }
    },
    [loadStillCurrent],
  );

  useEffect(() => {
    if (!activeRepo) {
      loadSeq.current += 1;
      setConversationIdInternal(externalConversationId ?? null);
      setMessages([]);
      setError(null);
      return;
    }
    // Invalidate in-flight post-send reloads immediately so a turn that started in
    // another repo cannot paint its transcript after this click.
    loadSeq.current += 1;
    setConversationIdInternal(null);
    setStreamAssistant(null);
    setMessages([]);
    setError(null);
    let cancelled = false;
    const repoId = activeRepo.id;
    (async () => {
      setLoading(true);
      try {
        let convId: string | null = null;
        if (externalConversationId) {
          try {
            await memorySetConversationCodingMeta(externalConversationId, repoId);
            convId = externalConversationId;
          } catch (metaErr) {
            const msg = metaErr instanceof Error ? metaErr.message : String(metaErr);
            console.warn(
              "[useCodingChat] stored conversation id is not valid for this coding personality/repo; falling back:",
              msg,
            );
          }
        }
        if (!convId) {
          convId = await invoke<string>("memory_get_or_create_coding_conversation", {
            repoId,
            repoName: activeRepo.name,
          });
          await memorySetConversationCodingMeta(convId, repoId);
        }
        if (cancelled) return;
        setConversationId(convId);
        const recent = await invoke<StoredMessage[]>("memory_get_recent", {
          conversationId: convId,
          limit: 200,
        });
        if (cancelled) return;
        if (!loadStillCurrent(convId, repoId)) return;
        setMessages(recent.map(storedToChatMessage));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setConversationIdInternal(null);
        setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeRepo?.id,
    activeRepo?.name,
    externalConversationId,
    loadStillCurrent,
    setConversationId,
    setConversationIdInternal,
  ]);

  useEffect(() => {
    let unlistenStart: (() => void) | undefined;
    let unlistenStream: (() => void) | undefined;
    let unlistenTool: (() => void) | undefined;
    let unlistenStatus: (() => void) | undefined;
    void (async () => {
      unlistenStart = await listen<ChatStreamStart>("chat:stream-start", (ev) => {
        if (!eventConversationMatches(ev.payload.conversationId)) return;
        setStreamAssistant((prev) => ({
          thinking: true,
          text: prev?.text ?? "",
          statusDetail: prev?.statusDetail ?? "Preparing…",
          toolActivity: prev?.toolActivity ?? null,
        }));
      });
      unlistenStream = await listen<ChatStreamEvent>("chat:stream", (ev) => {
        if (!eventConversationMatches(ev.payload.conversationId)) return;
        if (ev.payload.done) {
          if (sendingRef.current) return;
          setStreamAssistant(null);
          return;
        }
        setStreamAssistant((prev) => ({
          thinking: false,
          text: (prev?.text ?? "") + ev.payload.delta,
          statusDetail: prev?.statusDetail ?? null,
          toolActivity: prev?.toolActivity ?? null,
        }));
      });
      unlistenTool = await listen<ChatToolStreamEvent>("chat:tool-stream", (ev) => {
        if (!eventConversationMatches(ev.payload.conversationId)) return;
        setStreamAssistant((prev) => {
          const base = prev ?? {
            thinking: true,
            text: "",
            statusDetail: null,
            toolActivity: null,
          };
          const toolActivity = applyToolStreamEvent(base.toolActivity, ev.payload);
          return {
            ...base,
            thinking: ev.payload.phase === "start" ? true : base.thinking,
            statusDetail: ev.payload.phase === "start" ? null : base.statusDetail,
            toolActivity,
          };
        });
      });
      unlistenStatus = await listen<ChatTurnStatusEvent>("chat:turn-status", (ev) => {
        if (!eventConversationMatches(ev.payload.conversationId)) return;
        setStreamAssistant((prev) => {
          const base = prev ?? {
            thinking: true,
            text: "",
            statusDetail: null,
            toolActivity: null,
          };
          if (base.toolActivity?.running) return base;
          const detail = ev.payload.detail.trim();
          return {
            ...base,
            statusDetail: detail || null,
          };
        });
      });
    })();
    return () => {
      unlistenStart?.();
      unlistenStream?.();
      unlistenTool?.();
      unlistenStatus?.();
    };
  }, [eventConversationMatches]);

  const abortTurn = useCallback(() => {
    if (!sendingRef.current) return;
    setAbortedTurn(true);
    sendingRef.current = false;
    setStreamAssistant(null);
    setSending(false);
    setError("Turn aborted. The agent may still finish the current tool on the backend.");
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const convId = conversationId;
      const repoId = activeRepo?.id;
      if (!trimmed || sending || !convId || !repoId) return;

      setAbortedTurn(false);
      setMessages((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}`,
          role: "user",
          content: trimmed,
          createdAt: new Date().toISOString(),
        },
      ]);
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
        await memorySetConversationCodingMeta(convId, repoId);

        const result = await invoke<ChatSendResult>("chat_send_message", {
          conversationId: convId,
          message: trimmed,
          appMode: "coding",
          codingRepoId: repoId,
          uiTheme: getStoredTheme(),
        });
        const stillHere = loadStillCurrent(convId, repoId);
        if (!stillHere) {
          setStreamAssistant(null);
        } else if (abortedTurn) {
          setStreamAssistant(null);
        } else {
          setStreamAssistant({
            thinking: false,
            text: result.reply,
            statusDetail: null,
            toolActivity: null,
          });
        }
        if (stillHere) {
          await loadMessages(convId, { silent: true, repoId });
        }
      } catch (e) {
        if (loadStillCurrent(convId, repoId)) {
          setError(e instanceof Error ? e.message : String(e));
          await loadMessages(convId, { silent: true, repoId });
        }
      } finally {
        sendingRef.current = false;
        setStreamAssistant(null);
        setSending(false);
        setAbortedTurn(false);
      }
    },
    [activeRepo?.id, conversationId, loadMessages, loadStillCurrent, sending, abortedTurn],
  );

  return {
    conversationId,
    messages,
    loading,
    sending,
    streamAssistant,
    error,
    sendMessage,
    abortTurn,
  };
}
