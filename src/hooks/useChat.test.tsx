// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useChat } from "@/hooks/useChat";
import type { StoredConversation, StoredMessage } from "@/types/chat";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  memoryCreateConversation: vi.fn(),
  memoryDeleteConversation: vi.fn(),
  memoryExtractAnchorsFromConversation: vi.fn(),
  memoryGetRecent: vi.fn(),
  memoryListAnchors: vi.fn(),
  memoryListConversations: vi.fn(),
  memoryRenameConversation: vi.fn(),
  memorySetActivePersonality: vi.fn(),
  memoryStartupBriefing: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocks.listen,
}));

vi.mock("@/hooks/useNovaMemory", () => ({
  memoryCreateConversation: mocks.memoryCreateConversation,
  memoryDeleteConversation: mocks.memoryDeleteConversation,
  memoryExtractAnchorsFromConversation: mocks.memoryExtractAnchorsFromConversation,
  memoryGetRecent: mocks.memoryGetRecent,
  memoryListAnchors: mocks.memoryListAnchors,
  memoryListConversations: mocks.memoryListConversations,
  memoryRenameConversation: mocks.memoryRenameConversation,
  memorySetActivePersonality: mocks.memorySetActivePersonality,
  memoryStartupBriefing: mocks.memoryStartupBriefing,
}));

type ChatApi = ReturnType<typeof useChat>;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const conversations: StoredConversation[] = [
  { id: "thread-a", title: "Thread A", createdAt: "2026-01-01", updatedAt: "2026-01-01" },
  { id: "thread-b", title: "Thread B", createdAt: "2026-01-02", updatedAt: "2026-01-02" },
];

function storedMessage(id: number, content: string): StoredMessage {
  return {
    id,
    role: "user",
    content,
    createdAt: "2026-01-01",
  };
}

async function flushReact() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function waitFor(predicate: () => boolean) {
  for (let i = 0; i < 25; i += 1) {
    await flushReact();
    if (predicate()) return;
  }
  throw new Error("Timed out waiting for expected hook state");
}

describe("useChat thread loading", () => {
  let latest: ChatApi | null;
  let root: Root;
  let chatSend: Deferred<unknown>;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    latest = null;
    chatSend = deferred();

    for (const mock of Object.values(mocks)) {
      mock.mockReset();
    }

    mocks.listen.mockResolvedValue(() => undefined);
    mocks.invoke.mockImplementation((command: string) => {
      switch (command) {
        case "personality_get":
          return Promise.resolve({
            file: { activeProfileId: "default", profiles: [] },
            generatedSystemPrompt: "",
          });
        case "memory_set_active_personality":
        case "settings_update":
          return Promise.resolve();
        case "chat_vision_supported":
          return Promise.resolve(false);
        case "recipe_list":
          return Promise.resolve([]);
        case "project_list":
          return Promise.resolve({ projects: [], activeProjectId: null });
        case "chat_send_message":
          return chatSend.promise;
        default:
          return Promise.resolve(undefined);
      }
    });

    mocks.memorySetActivePersonality.mockResolvedValue(undefined);
    mocks.memoryListConversations.mockResolvedValue(conversations);
    mocks.memoryListAnchors.mockResolvedValue([]);
    mocks.memoryStartupBriefing.mockResolvedValue("");
    mocks.memoryGetRecent.mockImplementation((conversationId: string) => {
      return Promise.resolve([storedMessage(1, `${conversationId} initial history`)]);
    });

    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  it("does not let a completed send reload overwrite the newly selected thread", async () => {
    const threadBRecent = deferred<StoredMessage[]>();
    mocks.memoryGetRecent.mockImplementation((conversationId: string) => {
      if (conversationId === "thread-b") return threadBRecent.promise;
      return Promise.resolve([storedMessage(1, "thread-a history")]);
    });

    function Probe() {
      latest = useChat();
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    await waitFor(() => latest?.activeConversationId === "thread-a");

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = latest?.sendMessage("hello from A");
    });

    await act(async () => {
      latest?.selectConversation("thread-b");
    });
    await waitFor(() => latest?.activeConversationId === "thread-b");

    await act(async () => {
      chatSend.resolve({
        reply: "reply for A",
        toolCalls: [],
        providerId: "placeholder",
        modelId: "test",
      });
      await sendPromise;
    });

    threadBRecent.resolve([storedMessage(2, "thread-b visible history")]);
    await waitFor(() => latest?.messages[0]?.content === "thread-b visible history");

    expect(latest?.activeConversationId).toBe("thread-b");
    expect(latest?.messages).toEqual([
      expect.objectContaining({
        id: "2",
        content: "thread-b visible history",
      }),
    ]);
  });
});
