import { useMemo } from "react";
import { CopyButton } from "@/components/ui/CopyButton";
import { HighlightedCode } from "@/components/ui/HighlightedCode";
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
            className="overflow-hidden rounded-lg border border-ps-border bg-ps-elevated dark:border-ps-border dark:bg-ps-elevated"
          >
            <div className="flex items-center justify-between border-b border-ps-border bg-ps-elevated px-3 py-1.5 dark:border-ps-border dark:bg-ps-surface">
              {b.language ? (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ps-muted">
                  {b.language}
                </span>
              ) : (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-ps-faint">
                  Code
                </span>
              )}
              <CopyButton text={b.code} label="Copy code" />
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap p-3 text-xs leading-relaxed text-ps-ink dark:text-ps-ink">
              <HighlightedCode code={b.code} language={b.language} />
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
