import { useMemo, useState } from "react";
import DOMPurify from "dompurify";
import { marked } from "marked";
import { Columns2, Eye, PenLine } from "lucide-react";
import { CodeEditor } from "@/components/ui/CodeEditor";
import { CopyButton } from "@/components/ui/CopyButton";

const DEFAULT_MARKDOWN = `# Markdown Playground

Type Markdown on the left and see the **rendered rich text** live.

## What works

- Headings, **bold**, *italic*, ~~strikethrough~~
- [Links](https://example.com) and \`inline code\`
- Lists, tables, blockquotes, and horizontal rules

> Blockquotes look like this.

\`\`\`python
def hello():
    print("Code blocks too!")
\`\`\`

| Feature | Status |
| ------- | ------ |
| Preview | Live   |
| Export  | Copy button above |
`;

type ViewMode = "edit" | "split" | "preview";

/** Markdown editor with live sanitized rich-text preview. */
export function MarkdownPlaygroundPanel() {
  const [text, setText] = useState(DEFAULT_MARKDOWN);
  const [view, setView] = useState<ViewMode>("split");

  const renderedHtml = useMemo(() => {
    try {
      const raw = marked.parse(text, { async: false, gfm: true, breaks: true });
      return DOMPurify.sanitize(raw);
    } catch (e) {
      return `<p>Markdown render error: ${String(e)}</p>`;
    }
  }, [text]);

  const words = useMemo(
    () => text.split(/\s+/).filter(Boolean).length,
    [text],
  );

  const viewButton = (mode: ViewMode, label: string, Icon: typeof Eye) => (
    <button
      type="button"
      onClick={() => setView(mode)}
      title={label}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs font-medium ${
 view === mode
 ? "bg-ps-accent text-white"
 : "text-ps-faint hover:bg-ps-surface hover:text-ps-ink"
 }`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-ps-border bg-ps-elevated px-3 py-1.5">
        <div className="flex items-center gap-1">
          {viewButton("edit", "Edit", PenLine)}
          {viewButton("split", "Split", Columns2)}
          {viewButton("preview", "Preview", Eye)}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-ps-faint">
            {words} words · {text.length} chars
          </span>
          <CopyButton text={text} label="Copy markdown source" size="sm" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {view !== "preview" ? (
          <div
            className={`flex min-h-0 flex-col overflow-hidden ${
 view === "split" ? "w-1/2 border-r border-ps-border" : "flex-1"
 }`}
          >
            <CodeEditor
              value={text}
              onChange={setText}
              language="markdown"
              placeholder="Write Markdown here…"
            />
          </div>
        ) : null}
        {view !== "edit" ? (
          <div
            className={`min-h-0 overflow-y-auto bg-white px-5 py-4 dark:bg-ps-canvas ${
 view === "split" ? "w-1/2" : "flex-1"
 }`}
          >
            <div
              className="ps-markdown"
              // Rendered through marked then sanitized with DOMPurify.
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
