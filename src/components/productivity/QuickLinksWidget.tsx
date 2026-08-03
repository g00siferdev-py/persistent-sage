import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Plus, Trash2 } from "lucide-react";

type LinkItem = { id: string; title: string; url: string };

const LINKS_KEY = "persistent-sage.productivity.quickLinks";

function loadLinks(): LinkItem[] {
  try {
    const raw = localStorage.getItem(LINKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LinkItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLinks(items: LinkItem[]) {
  try {
    localStorage.setItem(LINKS_KEY, JSON.stringify(items));
  } catch {
    /* ignore */
  }
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t}`;
}

/** Local quick links opened via the system browser. */
export function QuickLinksWidget() {
  const [links, setLinks] = useState<LinkItem[]>(() => loadLinks());
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    saveLinks(links);
  }, [links]);

  const add = () => {
    const href = normalizeUrl(url);
    const label = title.trim() || href;
    if (!href) {
      setError("Enter a URL.");
      return;
    }
    setError(null);
    setLinks((prev) => [
      ...prev,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, title: label, url: href },
    ]);
    setTitle("");
    setUrl("");
  };

  const open = async (href: string) => {
    setError(null);
    try {
      await invoke("open_external_url", { url: href });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden p-3">
      <form
        className="space-y-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="ps-input w-full px-2.5 py-1.5 text-xs"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Link title"
        />
        <div className="flex gap-1.5">
          <input
            className="ps-input min-w-0 flex-1 px-2.5 py-1.5 text-xs"
            placeholder="https://…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Link URL"
          />
          <button type="submit" className="ps-btn-primary p-1.5" aria-label="Add link">
            <Plus className="size-3.5" />
          </button>
        </div>
      </form>
      {error ? <p className="text-[11px] text-ps-danger">{error}</p> : null}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {links.map((link) => (
          <li
            key={link.id}
            className="flex items-center gap-1 rounded-md border border-ps-border bg-ps-elevated px-2 py-1.5"
          >
            <button
              type="button"
              className="min-w-0 flex-1 text-left"
              onClick={() => void open(link.url)}
            >
              <p className="truncate text-xs font-medium text-ps-ink">{link.title}</p>
              <p className="truncate text-[10px] text-ps-faint">{link.url}</p>
            </button>
            <button
              type="button"
              className="ps-btn-ghost p-1"
              onClick={() => void open(link.url)}
              aria-label={`Open ${link.title}`}
            >
              <ExternalLink className="size-3.5" />
            </button>
            <button
              type="button"
              className="ps-btn-ghost p-1 text-ps-danger"
              onClick={() => setLinks((prev) => prev.filter((l) => l.id !== link.id))}
              aria-label={`Remove ${link.title}`}
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
        {links.length === 0 ? (
          <li className="py-6 text-center text-[11px] text-ps-faint">
            Add bookmarks — opened in your browser, stored only on this machine.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
