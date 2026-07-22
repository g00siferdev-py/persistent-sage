import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, FileText, Loader2, RefreshCw, Search } from "lucide-react";
import type { DriveFile, GoogleStatus } from "@/lib/googleTypes";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";
import { openExternalUrl } from "@/lib/legal";

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (s: GoogleStatus) => void;
};

function mimeLabel(mime: string): string {
  if (mime.includes("google-apps.document")) return "Doc";
  if (mime.includes("google-apps.spreadsheet")) return "Sheet";
  if (mime.includes("google-apps.presentation")) return "Slides";
  if (mime.includes("google-apps.folder")) return "Folder";
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "Image";
  if (mime.startsWith("text/")) return "Text";
  return "File";
}

export function DocumentsWidget({ status, onStatusChange }: Props) {
  const connected = !!status?.connected && !!status?.driveEnabled;
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ files: DriveFile[] }>("google_drive_list", {
        query: q || null,
        maxResults: 25,
      });
      setFiles(resp.files);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void load("");
  }, [connected, load]);

  if (!connected) {
    return <GoogleConnectCard status={status} onStatusChange={onStatusChange} compact />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-ps-border px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-ps-faint" aria-hidden />
          <input
            className="ps-input w-full py-1 pl-7 pr-2 text-[11px]"
            placeholder="Search Drive by name or content"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(query);
            }}
          />
        </div>
        <button type="button" className="ps-btn-ghost p-1.5" onClick={() => void load(query)} title="Refresh" aria-label="Refresh documents">
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="px-3 py-2 text-xs text-ps-danger">{error}</p> : null}
        {loading && files.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-4 text-xs text-ps-faint">
            <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading files…
          </div>
        ) : files.length === 0 && !error ? (
          <p className="px-3 py-4 text-xs text-ps-faint">No files found.</p>
        ) : (
          <ul>
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 border-b border-ps-border/40 px-3 py-2">
                <FileText className="size-3.5 shrink-0 text-ps-accent" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-ps-ink">{f.name}</p>
                  <p className="truncate text-[10px] text-ps-faint">
                    {mimeLabel(f.mimeType)}
                    {f.modifiedTime ? ` · ${new Date(f.modifiedTime).toLocaleDateString()}` : ""}
                  </p>
                </div>
                {f.webViewLink ? (
                  <button
                    type="button"
                    className="ps-btn-ghost shrink-0 p-1"
                    onClick={() => void openExternalUrl(f.webViewLink!)}
                    title="Open in Google Drive"
                    aria-label={`Open ${f.name} in Google Drive`}
                  >
                    <ExternalLink className="size-3" aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
