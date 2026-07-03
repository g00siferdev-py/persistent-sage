import { useMemo } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { renderMarkdownBlocks } from "@/lib/artifacts";

type Props = { text: string };

export function MessageContent({ text }: Props) {
  const blocks = useMemo(() => renderMarkdownBlocks(text), [text]);

  if (blocks.length === 0) {
    return null;
  }

  if (blocks.length === 1 && blocks[0]!.type === "paragraph") {
    return <p className="whitespace-pre-wrap">{blocks[0]!.text}</p>;
  }

  return (
    <div className="space-y-3">
      {blocks.map((b, i) =>
        b.type === "code" ? (
          <div
            key={i}
            className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900"
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-100/80 px-3 py-1.5 dark:border-slate-700 dark:bg-slate-800/80">
              {b.language ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                  {b.language}
                </span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  Code
                </span>
              )}
              <CopyButton text={b.code} label="Copy code" />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-slate-800 dark:text-slate-100">
              <code>{b.code}</code>
            </pre>
          </div>
        ) : (
          <p key={i} className="whitespace-pre-wrap">
            {b.text}
          </p>
        ),
      )}
    </div>
  );
}
