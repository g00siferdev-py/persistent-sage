export type ChatToolStreamEvent = {
  conversationId: string;
  toolName: string;
  phase: "start" | "output" | "end";
  detail: string;
  delta: string;
};

export type ToolActivityState = {
  toolName: string;
  detail: string;
  output: string;
  running: boolean;
} | null;

const TOOL_OUTPUT_MAX = 48_000;

export function applyToolStreamEvent(
  prev: ToolActivityState,
  ev: ChatToolStreamEvent,
): ToolActivityState {
  switch (ev.phase) {
    case "start":
      return {
        toolName: ev.toolName,
        detail: ev.detail,
        output: "",
        running: true,
      };
    case "output": {
      if (!prev) return prev;
      const next = prev.output + ev.delta;
      return {
        ...prev,
        output:
          next.length > TOOL_OUTPUT_MAX ? next.slice(-TOOL_OUTPUT_MAX) : next,
      };
    }
    case "end":
      return prev ? { ...prev, running: false } : prev;
    default:
      return prev;
  }
}
