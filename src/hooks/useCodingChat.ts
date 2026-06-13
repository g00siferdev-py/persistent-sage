import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ChatMessage, ChatSendResult, StoredMessage } from "@/types/chat";
import { storedToChatMessage } from "@/types/chat";
import { memoryGetRecent, memorySetActivePersonality } from "@/hooks/useNovaMemory";
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

export function useCodingChat(activeRepo: ActiveRepo | null) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamAssistant, setStreamAssistant] = useState<CodingStreamState>(null);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const loadSeq = useRef(0);

  const eventConversationMatches = useCallback((id: string) => {
    const active = conversationIdRef.current;
    if (!active) return sendingRef.current;
    return id === active;
  }, []);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const loadMessages = useCallback(async (convId: string, options?: { silent?: boolean }) => {
    const silent = options?.silent ?? false;
    const seq = ++loadSeq.current;
    if (!silent) setLoading(true);
    try {
      const recent = await memoryGetRecent(convId, 200);
      if (seq !== loadSeq.current) return;
      setMessages(recent.map(storedToChatMessage));
      setError(null);
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      if (!silent) setMessages([]);
    } finally {
      if (seq === loadSeq.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeRepo) {
      setConversationId(null);
      setMessages([]);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await memorySetActivePersonality("__coding__");
        const convId = await invoke<string>("memory_get_or_create_coding_conversation", {
          repoId: activeRepo.id,
          repoName: activeRepo.name,
        });
        if (cancelled) return;
        setConversationId(convId);
        const recent = await invoke<StoredMessage[]>("memory_get_recent", {
          conversationId: convId,
          limit: 200,
        });
        if (cancelled) return;
        setMessages(recent.map(storedToChatMessage));
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setConversationId(null);
        setMessages([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRepo?.id, activeRepo?.name]);

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

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const convId = conversationId;
      const repoId = activeRepo?.id;
      if (!trimmed || sending || !convId || !repoId) return;

      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: "user", content: trimmed },
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
        const result = await invoke<ChatSendResult>("chat_send_message", {
          conversationId: convId,
          message: trimmed,
          personalityId: "__coding__",
          appMode: "coding",
          codingRepoId: repoId,
        });
        setStreamAssistant({
          thinking: false,
          text: result.reply,
          statusDetail: null,
          toolActivity: null,
        });
        await loadMessages(convId, { silent: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        await loadMessages(convId, { silent: true });
      } finally {
        sendingRef.current = false;
        setStreamAssistant(null);
        setSending(false);
      }
    },
    [activeRepo?.id, conversationId, loadMessages, sending],
  );

  return {
    conversationId,
    messages,
    loading,
    sending,
    streamAssistant,
    error,
    sendMessage,
  };
}
