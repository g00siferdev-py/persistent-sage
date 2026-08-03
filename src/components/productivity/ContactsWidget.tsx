import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2, Mail, Phone, RefreshCw, Search } from "lucide-react";
import type { GoogleStatus } from "@/lib/googleTypes";
import { GoogleConnectCard } from "@/components/productivity/GoogleConnectCard";

type Contact = {
  id: string;
  name: string;
  emails: string[];
  phones: string[];
};

type Props = {
  status: GoogleStatus | null;
  onStatusChange: (s: GoogleStatus) => void;
};

/** Google Contacts (People API) — search and browse. */
export function ContactsWidget({ status, onStatusChange }: Props) {
  const connected = !!status?.connected && !!status?.enabled;
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const resp = await invoke<{ contacts: Contact[] }>("google_contacts_list", {
        query: q || null,
        pageSize: 40,
      });
      setContacts(resp.contacts ?? []);
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
    <div className="flex h-full flex-col gap-2 overflow-hidden p-3">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void load(query);
        }}
      >
        <input
          className="ps-input min-w-0 flex-1 px-2.5 py-1.5 text-xs"
          placeholder="Search contacts…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search contacts"
        />
        <button type="submit" className="ps-btn p-1.5" disabled={loading} aria-label="Search">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
        </button>
        <button
          type="button"
          className="ps-btn p-1.5"
          onClick={() => void load(query)}
          disabled={loading}
          aria-label="Refresh"
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </form>
      {error ? (
        <p className="text-[11px] text-ps-danger">
          {error}
          {/403|not been used|disabled/i.test(error) ? (
            <>
              {" "}
              Enable the <strong>People API</strong> in Google Cloud, then reconnect Google under
              Settings if needed.
            </>
          ) : /insufficient|scope|auth/i.test(error) ? (
            <> Reconnect Google under Settings to grant Contacts access.</>
          ) : null}
        </p>
      ) : null}
      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {contacts.map((c) => (
          <li
            key={c.id}
            className="rounded-md border border-ps-border bg-ps-elevated px-2.5 py-2"
          >
            <p className="text-xs font-medium text-ps-ink">{c.name || "Unnamed"}</p>
            <div className="mt-1 space-y-0.5">
              {c.emails.slice(0, 2).map((email) => (
                <a
                  key={email}
                  href={`mailto:${email}`}
                  className="flex items-center gap-1.5 text-[11px] text-ps-accent hover:underline"
                >
                  <Mail className="size-3 shrink-0" aria-hidden />
                  {email}
                </a>
              ))}
              {c.phones.slice(0, 2).map((phone) => (
                <p key={phone} className="flex items-center gap-1.5 text-[11px] text-ps-muted">
                  <Phone className="size-3 shrink-0" aria-hidden />
                  {phone}
                </p>
              ))}
            </div>
          </li>
        ))}
        {!loading && !error && contacts.length === 0 ? (
          <li className="py-6 text-center text-[11px] text-ps-faint">No contacts found.</li>
        ) : null}
      </ul>
    </div>
  );
}
