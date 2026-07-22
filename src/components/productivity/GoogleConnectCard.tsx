import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, LogIn } from "lucide-react";
import type { GoogleStatus } from "@/lib/googleTypes";

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (status: GoogleStatus) => void;
  /** Compact variant used inside widgets. */
  compact?: boolean;
};

/** Sign-in prompt shown when a Google-backed widget has no connected account. */
export function GoogleConnectCard({ status, onStatusChange, compact = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await invoke<GoogleStatus>("google_auth_start");
      onStatusChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const missingSetup = !status?.enabled || !status?.hasClientId;

  return (
    <div className={`flex h-full flex-col items-center justify-center gap-3 px-6 text-center ${compact ? "py-4" : "py-10"}`}>
      <p className="text-sm text-ps-muted">
        {missingSetup ? (
          <>
            Google Workspace is not set up yet. Enable it and add your OAuth
            Client ID under <strong className="text-ps-ink">Settings → Tools → Google Workspace</strong>.
          </>
        ) : (
          <>Connect your Google account to use Gmail, Calendar, and Drive here and from companion chat.</>
        )}
      </p>
      {!missingSetup ? (
        <button type="button" onClick={() => void connect()} disabled={busy} className="ps-btn-primary px-4 py-2">
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogIn className="size-4" aria-hidden />
          )}
          {busy ? "Waiting for browser sign-in…" : "Connect Google account"}
        </button>
      ) : null}
      {error ? <p className="max-w-sm text-xs text-ps-danger">{error}</p> : null}
    </div>
  );
}
