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
    <div className="mt-2 overflow-hidden rounded-md border border-slate-700/80 bg-black/50">
      <div className="flex items-center gap-2 border-b border-slate-700/80 px-2.5 py-1.5 text-[11px] text-slate-400">
        {activity.running ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-violet-400" aria-hidden />
        ) : (
          <Terminal className="h-3 w-3 shrink-0 text-slate-500" aria-hidden />
        )}
        <span className="font-medium text-slate-300">{label}</span>
        {activity.detail ? (
          <span className="min-w-0 truncate font-mono text-slate-500" title={activity.detail}>
            {activity.detail}
          </span>
        ) : null}
      </div>
      <pre
        ref={outputRef}
        className="max-h-52 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-slate-300"
      >
        {activity.output || (activity.running ? "Waiting for output…" : "(no output)")}
      </pre>
    </div>
  );
}
