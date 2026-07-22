import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  Code2,
  Cpu,
  ExternalLink,
  FolderOpen,
  Globe,
  Keyboard,
  MessageCircle,
  Rocket,
  Star,
} from "lucide-react";
import { LEGAL_LINKS, openExternalUrl } from "@/lib/legal";
import packageJson from "../../../package.json";

type AppPlatform = "windows" | "linux" | "macos" | "unknown";

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  const open = useCallback(async () => {
    await openExternalUrl(href);
  }, [href]);

  return (
    <button
      type="button"
      onClick={() => void open()}
      className="inline-flex items-center gap-1 font-medium text-ps-accent hover:underline"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </button>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2 border-l-2 border-ps-border pl-3">
      <h3 className="font-display flex items-center gap-2 text-sm font-semibold tracking-tight text-ps-ink">
        {icon}
        {title}
      </h3>
      <div className="text-xs leading-relaxed text-ps-muted">{children}</div>
    </section>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-ps-border bg-ps-elevated px-1.5 py-0.5 font-mono text-[10px] text-ps-ink">
      {children}
    </kbd>
  );
}

export function HelpContent() {
  const [platform, setPlatform] = useState<AppPlatform>("unknown");
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [version, setVersion] = useState(packageJson.version);

  useEffect(() => {
    void invoke<AppPlatform>("app_platform")
      .then(setPlatform)
      .catch(() => setPlatform("unknown"));
    void invoke<{ dataDirectory: string }>("app_data_paths")
      .then((p) => setDataDir(p.dataDirectory))
      .catch(() => setDataDir(null));
    void invoke<string>("app_version")
      .then((raw) => {
        const v = raw.trim().split(/\s+/).pop();
        if (v) setVersion(v);
      })
      .catch(() => {
        /* keep package.json version */
      });
  }, []);

  const installDoc =
    platform === "windows" ? LEGAL_LINKS.installWindows : LEGAL_LINKS.install;

  return (
    <div className="space-y-6">
      <div>
        <p className="ps-label mb-1">Help · v{version}</p>
        <h2 className="font-display flex items-center gap-2 text-lg font-semibold tracking-tight text-ps-ink">
          <BookOpen className="size-5 text-ps-accent" aria-hidden />
          Persistent Sage
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-ps-faint">
          A local-first AI companion. Chats, memory, and settings live in a SQLite
          database on this machine — nothing syncs anywhere unless you connect a
          provider.
        </p>
      </div>

      <Section
        icon={<Rocket className="size-4 text-ps-warm" aria-hidden />}
        title="Getting started"
      >
        <ol className="list-inside list-decimal space-y-1">
          <li>
            Open <strong>Settings → Provider</strong> and pick a backend (OpenAI,
            Anthropic, Google Gemini, xAI, or local/cloud Ollama) with an API key
            where required.
          </li>
          <li>
            Click <strong>New chat</strong> in the sidebar to start a thread with
            your active companion.
          </li>
          <li>
            Turn on optional agent capabilities under{" "}
            <strong>Settings → Tools</strong> (workspace files, browser fetch, PDF
            read/write, Moltbook, coding tools).
          </li>
        </ol>
      </Section>

      <Section
        icon={<MessageCircle className="size-4 text-ps-accent" aria-hidden />}
        title="Companion mode"
      >
        <ul className="list-inside list-disc space-y-1">
          <li>
            Pick who you are talking to with the <strong>companion selector</strong>{" "}
            in the top bar — each companion keeps isolated memory and personality.
            Manage profiles under <strong>Settings → Companion</strong>.
          </li>
          <li>
            <strong>Memory Anchor</strong> (sidebar) stores long-term notes per
            companion; use <em>Extract raw anchors</em> or the recall search to
            revisit them.
          </li>
          <li>
            <strong>Favorites</strong> <Star className="inline size-3 text-ps-warm" aria-hidden />{" "}
            — star any message, then browse them from the top bar.
          </li>
          <li>
            <strong>Share</strong> a message to X, Reddit, Bluesky, and more — or
            ask your companion to post on Moltbook as itself.
          </li>
          <li>
            Attach <strong>images</strong> (file or webcam) when the selected model
            supports vision; set <strong>thinking effort</strong> from the composer
            toolbar.
          </li>
          <li>
            <strong>Projects &amp; artifacts</strong> — living documents, charts,
            HTML, tables, and forms render right in the thread (enable artifacts in
            Settings → Tools).
          </li>
          <li>
            <strong>Pulse</strong> (Settings → General) runs scheduled companion
            check-ins in your open thread.
          </li>
        </ul>
      </Section>

      <Section
        icon={<Globe className="size-4 text-ps-warm" aria-hidden />}
        title="Moltbook"
      >
        <p>
          Moltbook is a social network where the <em>agents</em> post — humans
          never do. Once enabled under <strong>Settings → Tools</strong> with an
          API key, your companion can browse the feed, post, and comment; a
          background scheduler handles periodic check-ins. Browse it read-only
          from the <strong>Moltbook</strong> button in the chat top bar.
        </p>
      </Section>

      <Section
        icon={<Code2 className="size-4 text-ps-success" aria-hidden />}
        title="Coding mode"
      >
        <ul className="list-inside list-disc space-y-1">
          <li>
            Switch modes from the tabs in the top-left. Coding manages git repos
            under <code className="text-[10px]">workspace/repos/</code>.
          </li>
          <li>
            Create a project from a template, clone over HTTPS, or drop a repo
            into the folder and hit <strong>Refresh</strong>.
          </li>
          <li>
            Multi-tab <strong>editor</strong> (Ctrl+S saves), integrated{" "}
            <strong>terminal</strong> with an allowlisted shell (
            {platform === "windows" ? "cmd.exe" : "sh"} here), and{" "}
            <strong>playgrounds</strong> for running code snippets, Markdown, and
            JSON.
          </li>
          <li>
            The coding agent can grep, patch, run commands, and use git — enable
            under <strong>Settings → Tools → Coding mode (v2)</strong>. Live
            output streams into the terminal and the Stream panel.
          </li>
          <li>
            Store a <strong>GitHub PAT</strong> (encrypted) for push/pull/clone —
            see <DocLink href={LEGAL_LINKS.codingMode}>CODING-MODE.md</DocLink>.
          </li>
        </ul>
      </Section>

      <Section
        icon={<Keyboard className="size-4 text-ps-faint" aria-hidden />}
        title="Shortcuts"
      >
        <ul className="space-y-1">
          <li>
            <Key>Enter</Key> send message · <Key>Shift</Key>+<Key>Enter</Key> new line
          </li>
          <li>
            <Key>Ctrl</Key>+<Key>S</Key> save the active file (coding editor)
          </li>
          <li>
            <Key>Esc</Key> close dialogs like this one
          </li>
        </ul>
      </Section>

      <Section
        icon={<Cpu className="size-4 text-ps-faint" aria-hidden />}
        title="Your data"
      >
        {dataDir ? (
          <p className="mb-2 font-mono text-[10px] text-ps-faint" title={dataDir}>
            Data folder: {dataDir.length > 56 ? `…${dataDir.slice(-52)}` : dataDir}
          </p>
        ) : null}
        <ul className="list-inside list-disc space-y-1">
          <li>
            Chats, anchors, and memory live in a local SQLite file; API keys are
            stored <strong>encrypted</strong>. See the{" "}
            <DocLink href={LEGAL_LINKS.privacy}>privacy policy</DocLink> for the
            full breakdown.
          </li>
          {platform === "windows" ? (
            <>
              <li>
                Default: <code className="text-[10px]">%APPDATA%\g00siferdev-py\persistent-sage</code>
              </li>
              <li>
                Portable: launch with{" "}
                <code className="text-[10px]">Start Persistent Sage (Portable).bat</code>
              </li>
            </>
          ) : platform === "linux" ? (
            <>
              <li>
                Default: <code className="text-[10px]">~/.local/share/g00siferdev-py/persistent-sage</code>
              </li>
              <li>
                Portable: set <code className="text-[10px]">PERSISTENT_SAGE_PORTABLE=1</code>;
                custom path via <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code>
              </li>
            </>
          ) : platform === "macos" ? (
            <>
              <li>
                Default: <code className="text-[10px]">~/Library/Application Support/g00siferdev-py/persistent-sage</code>
              </li>
              <li>
                Override with <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code>
              </li>
            </>
          ) : (
            <li>
              Set <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code> to choose a data folder.
            </li>
          )}
          <li>
            <button
              type="button"
              onClick={() => void invoke("reveal_data_directory")}
              className="inline-flex items-center gap-1 font-medium text-ps-accent hover:underline"
            >
              <FolderOpen className="size-3" aria-hidden />
              Reveal data folder
            </button>
          </li>
        </ul>
      </Section>

      <section className="space-y-2 border border-ps-border bg-ps-elevated p-3" style={{ borderRadius: "var(--ps-radius-lg)" }}>
        <h3 className="ps-label">Documentation &amp; support</h3>
        <ul className="space-y-1 text-xs">
          <li>
            <DocLink href={LEGAL_LINKS.userGuide}>User guide</DocLink> — day-to-day usage, memory, Pulse
          </li>
          <li>
            <DocLink href={installDoc}>Install guide</DocLink> — build and first-run setup
          </li>
          <li>
            <DocLink href={LEGAL_LINKS.codingMode}>Coding mode guide</DocLink> — repos, agent tools, GitHub PAT
          </li>
          <li>
            <DocLink href={LEGAL_LINKS.privacy}>Privacy policy</DocLink>
          </li>
          <li>
            <DocLink href={LEGAL_LINKS.issues}>Report a problem</DocLink> — GitHub Issues (include OS, version, provider)
          </li>
          <li>
            <DocLink href={LEGAL_LINKS.support}>Support development</DocLink> — optional donations
          </li>
        </ul>
      </section>
    </div>
  );
}
