import { useMemo, useRef, type CSSProperties } from "react";
import { highlightCode } from "@/lib/highlight";

type Props = {
  value: string;
  onChange: (next: string) => void;
  language?: string | null;
  placeholder?: string;
  readOnly?: boolean;
  showLineNumbers?: boolean;
  className?: string;
};

const SHARED_TEXT_STYLE: CSSProperties = {
  fontFamily:
    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
  fontSize: "12px",
  lineHeight: "1.45rem",
  tabSize: 4,
};

/**
 * Syntax-highlighted code editor: a transparent-text textarea layered over a
 * highlight.js-rendered <pre> with identical font metrics. The textarea owns
 * input/selection; the pre provides the colors.
 */
export function CodeEditor({
  value,
  onChange,
  language,
  placeholder,
  readOnly = false,
  showLineNumbers = true,
  className = "",
}: Props) {
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);

  const html = useMemo(() => {
    const highlighted = highlightCode(value, language);
    // Trailing newline keeps the pre's height in sync while typing on a new line.
    return value.endsWith("\n") ? `${highlighted}\n` : highlighted;
  }, [value, language]);

  const lineCount = Math.max(1, value.split("\n").length);
  const lineNumbers = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1),
    [lineCount],
  );

  const syncScroll = (el: HTMLTextAreaElement) => {
    if (preRef.current) {
      preRef.current.scrollTop = el.scrollTop;
      preRef.current.scrollLeft = el.scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = el.scrollTop;
    }
  };

  return (
    <div className={`flex min-h-0 flex-1 overflow-hidden ${className}`}>
      {showLineNumbers ? (
        <div
          ref={gutterRef}
          className="shrink-0 select-none overflow-hidden border-r border-slate-200 bg-slate-100/70 py-2 pl-2 pr-2 text-right font-mono text-[11px] leading-[1.45rem] text-slate-400 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-600"
          aria-hidden
        >
          {lineNumbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      ) : null}
      <div className="relative min-h-0 min-w-0 flex-1">
        <pre
          ref={preRef}
          aria-hidden
          className="pointer-events-none absolute inset-0 m-0 overflow-hidden whitespace-pre py-2 pl-2 pr-4"
          style={SHARED_TEXT_STYLE}
        >
          <code
            className="hljs block bg-transparent"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
        <textarea
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            syncScroll(e.target);
          }}
          onScroll={(e) => syncScroll(e.currentTarget)}
          spellCheck={false}
          readOnly={readOnly}
          placeholder={placeholder}
          className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre bg-transparent py-2 pl-2 pr-4 text-transparent caret-slate-900 outline-none selection:bg-indigo-500/25 placeholder:text-slate-400 dark:caret-slate-100 dark:placeholder:text-slate-600"
          style={SHARED_TEXT_STYLE}
        />
      </div>
    </div>
  );
}
