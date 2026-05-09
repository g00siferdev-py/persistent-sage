import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  ChatMessage,
  ChatSendResult,
  StoredAnchor,
  StoredConversation,
} from "@/types/chat";
import { storedToChatMessage } from "@/types/chat";
import {
  memoryCreateConversation,
  memoryDeleteConversation,
  memoryExtractAnchorsFromConversation,
  memoryGetRecent,
  memoryListAnchors,
  memoryListConversations,
  memoryRenameConversation,
  memoryStartupBriefing,
} from "@/hooks/useNovaMemory";

const RECENT_LIMIT = 200;

type ChatStreamStart = { conversationId: string };
type ChatStreamEvent = { conversationId: string; delta: string; done: boolean };

export type StreamAssistantState = {
  thinking: boolean;
  text: string;
} | null;

export function useChat() {
  const [conversations, setConversations] = useState<StoredConversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [briefing, setBriefing] = useState<string>("");
  const [anchors, setAnchors] = useState<StoredAnchor[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [streamAssistant, setStreamAssistant] = useState<StreamAssistantState>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSeq = useRef(0);
  const activeConversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

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
    try {
      const [brief, recent, anchorList] = await Promise.all([
        memoryStartupBriefing(conversationId),
        memoryGetRecent(conversationId, RECENT_LIMIT),
        memoryListAnchors(conversationId, 48),
      ]);
      if (seq !== loadSeq.current) return;
      setBriefing(brief);
      setAnchors(anchorList);
      setMessages(recent.map(storedToChatMessage));
    } catch (e) {
      if (seq !== loadSeq.current) return;
      const msg =
        e instanceof Error
          ? e.message
          : "Could not load chat history. Use npm run tauri dev for the full app.";
      setError(msg);
      setBriefing("");
      setAnchors([]);
      setMessages([]);
    } finally {
      if (seq === loadSeq.current) setThreadLoading(false);
    }
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setListLoading(true);
      const list = await refreshConversations();
      if (cancelled) return;
      setListLoading(false);
      if (list.length === 0) {
        setActiveConversationId(null);
        return;
      }
      setActiveConversationId((prev) => {
        if (prev && list.some((c) => c.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshConversations]);

  useEffect(() => {
    if (!activeConversationId) {
      setBriefing("");
      setAnchors([]);
      setMessages([]);
      return;
    }
    void loadActiveThread(activeConversationId);
  }, [activeConversationId, loadActiveThread]);

  const selectConversation = useCallback((id: string) => {
    setActiveConversationId(id);
  }, []);

  const startNewConversation = useCallback(async () => {
    setError(null);
    try {
      const id = await memoryCreateConversation("New chat");
      await refreshConversations();
      setActiveConversationId(id);
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not create conversation (run in Tauri?)";
      setError(msg);
    }
  }, [refreshConversations]);

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
    [refreshConversations],
  );

  const extractAnchorsFromChat = useCallback(async () => {
    if (!activeConversationId) return;
    setError(null);
    try {
      await memoryExtractAnchorsFromConversation(activeConversationId, 12);
      await loadActiveThread(activeConversationId);
      await refreshConversations();
    } catch (e) {
      const msg =
        e instanceof Error ? e.message : "Could not extract anchors (run in Tauri?)";
      setError(msg);
    }
  }, [activeConversationId, loadActiveThread, refreshConversations]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const convId = activeConversationId;
      if (!trimmed || !convId || sending) return;

      const tempUserId = `local-${Date.now()}`;
      setMessages((prev) => [...prev, { id: tempUserId, role: "user", content: trimmed }]);
      setSending(true);
      setStreamAssistant(null);
      setError(null);

      const unlisteners: Array<() => void> = [];

      try {
        unlisteners.push(
          await listen<ChatStreamStart>("chat:stream-start", (event) => {
            if (event.payload.conversationId !== activeConversationIdRef.current) return;
            setStreamAssistant({ thinking: true, text: "" });
          }),
        );

        unlisteners.push(
          await listen<ChatStreamEvent>("chat:stream", (event) => {
            if (event.payload.conversationId !== activeConversationIdRef.current) return;
            const { delta, done } = event.payload;
            if (done) {
              setStreamAssistant(null);
              return;
            }
            if (delta) {
              setStreamAssistant((prev) => ({
                thinking: false,
                text: (prev?.text ?? "") + delta,
              }));
            }
          }),
        );

        unlisteners.push(
          await listen<string>("chat:stream-error", (event) => {
            if (convId !== activeConversationIdRef.current) return;
            setError(event.payload);
            setStreamAssistant(null);
          }),
        );

        const result = await invoke<ChatSendResult>("chat_send_message", {
          conversationId: convId,
          message: trimmed,
        });

        const assistantId = `local-a-${Date.now()}`;
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", content: result.reply },
        ]);

        void refreshSidebarContext(convId);
        await refreshConversations();
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Could not send message. Use npm run tauri dev (invoke + streaming require the Tauri shell).";
        setError(msg);
        await loadActiveThread(convId);
        await refreshConversations();
      } finally {
        for (const u of unlisteners) {
          try {
            u();
          } catch {
            /* ignore */
          }
        }
        setStreamAssistant(null);
        setSending(false);
      }
    },
    [
      activeConversationId,
      sending,
      loadActiveThread,
      refreshConversations,
      refreshSidebarContext,
    ],
  );

  return {
    conversations,
    activeConversationId,
    messages,
    briefing,
    anchors,
    listLoading,
    threadLoading,
    sending,
    streamAssistant,
    error,
    selectConversation,
    startNewConversation,
    renameConversation,
    deleteConversation,
    extractAnchorsFromChat,
    sendMessage,
    refreshConversations,
  };
}
