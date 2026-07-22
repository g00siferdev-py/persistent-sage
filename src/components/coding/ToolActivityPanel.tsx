import { useEffect, useRef } from "react";
import { Loader2, Terminal } from "lucide-react";
import { toolDisplayName } from "@/lib/toolDisplayNames";
import type { ToolActivityState } from "@/types/toolStream";

type Props = {
  activity: ToolActivityState;
};

export function ToolActivityPanel({ activity }: Props) {
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activity?.output]);

  if (!activity) return null;

  const label = toolDisplayName(activity.toolName);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-ps-border bg-black/50">
      <div className="flex items-center gap-2 border-b border-ps-border px-2.5 py-1.5 text-[11px] text-ps-faint">
        {activity.running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-ps-accent" aria-hidden />
        ) : (
          <Terminal className="h-3 w-3 shrink-0 text-ps-faint" aria-hidden />
        )}
        <span className="font-medium text-ps-muted">{label}</span>
        {activity.detail ? (
          <span className="min-w-0 truncate font-mono text-ps-faint" title={activity.detail}>
            {activity.detail}
          </span>
        ) : null}
      </div>
      <pre
        ref={outputRef}
        className="max-h-52 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-ps-muted"
      >
        {activity.output || (activity.running ? "Waiting for output…" : "(no output)")}
      </pre>
    </div>
  );
}
