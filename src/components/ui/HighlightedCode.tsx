import { useMemo } from "react";
import { highlightCode } from "@/lib/highlight";

type Props = {
  code: string;
  language?: string | null;
  className?: string;
};

/** Read-only syntax-highlighted code (highlight.js output is HTML-escaped). */
export function HighlightedCode({ code, language, className = "" }: Props) {
  const html = useMemo(() => highlightCode(code, language), [code, language]);
  return (
    <code
      className={`hljs ${className}`}
      // highlight.js escapes source text before wrapping tokens in spans.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
