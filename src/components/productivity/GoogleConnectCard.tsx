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
      // Backend auto-enables Google Workspace on first sign-in.
      const next = await invoke<GoogleStatus>("google_auth_start", { account: "user" });
      onStatusChange(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const missingClient = !!status && !status.hasClientId;
  const canSignIn = !missingClient;

  return (
    <div
      className={`flex h-full flex-col items-center justify-center gap-3 px-6 text-center ${compact ? "py-4" : "py-10"}`}
    >
      <p className="text-sm text-ps-muted">
        {missingClient ? (
          <>
            This development build has no built-in Google app. Use an official Persistent Sage
            installer for one-click sign-in, or add a Desktop OAuth client under{" "}
            <strong className="text-ps-ink">Settings → Tools → Google → Advanced</strong>.
          </>
        ) : (
          <>
            Click <strong className="text-ps-ink">Sign in with Google</strong> — your browser opens,
            you approve access, then Productivity widgets unlock (Gmail, Calendar, Drive, Contacts,
            Tasks). No Client ID or secret to paste.
          </>
        )}
      </p>
      {canSignIn ? (
        <button
          type="button"
          onClick={() => void connect()}
          disabled={busy}
          className="ps-btn-primary px-5 py-2.5 text-sm"
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogIn className="size-4" aria-hidden />
          )}
          {busy ? "Waiting for browser…" : "Sign in with Google"}
        </button>
      ) : null}
      {error ? <p className="max-w-sm text-xs text-ps-danger">{error}</p> : null}
    </div>
  );
}
