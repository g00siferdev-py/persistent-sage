import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, BookOpen, Cpu, MessageCircle, Code2, FolderOpen } from "lucide-react";
import { LEGAL_LINKS, openExternalUrl } from "@/lib/legal";

type AppPlatform = "windows" | "linux" | "macos" | "unknown";

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  const open = useCallback(async () => {
    await openExternalUrl(href);
  }, [href]);

  return (
    <button
      type="button"
      onClick={() => void open()}
      className="inline-flex items-center gap-1 font-medium text-ps-accent hover:underline dark:text-ps-accent"
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
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-ps-ink">
        {icon}
        {title}
      </h3>
      <div className="text-xs leading-relaxed text-ps-muted">{children}</div>
    </section>
  );
}

export function HelpContent() {
  const [platform, setPlatform] = useState<AppPlatform>("unknown");
  const [dataDir, setDataDir] = useState<string | null>(null);

  useEffect(() => {
    void invoke<AppPlatform>("app_platform")
      .then(setPlatform)
      .catch(() => setPlatform("unknown"));
    void invoke<{ dataDirectory: string }>("app_data_paths")
      .then((p) => setDataDir(p.dataDirectory))
      .catch(() => setDataDir(null));
  }, []);

  const installDoc =
    platform === "windows" ? LEGAL_LINKS.installWindows : LEGAL_LINKS.install;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-base font-semibold text-ps-ink">
          <BookOpen className="size-5 text-ps-accent" aria-hidden />
          Persistent Sage — Help
        </h2>
        <p className="mt-1 text-xs text-ps-faint">
          Local-first AI companion: chat, memory, personality, and a coding workspace for your repos.
        </p>
      </div>

      <Section icon={<MessageCircle className="size-4 text-ps-accent" aria-hidden />} title="Companion mode">
        <ul className="list-inside list-disc space-y-1">
          <li>
            <strong>New chat</strong> in the sidebar starts a thread for your active companion profile.
          </li>
          <li>
            Open <strong>Settings</strong> (chat header) → Provider for API keys and models; Tools for agent
            capabilities; Companion for personality.
          </li>
          <li>
            <strong>Memory Anchor</strong> in the sidebar stores long-term notes scoped to each companion.
          </li>
          <li>
            <strong>Pulse</strong> (Settings → General) runs scheduled check-ins in your open thread.
          </li>
        </ul>
      </Section>

      <Section icon={<Code2 className="size-4 text-emerald-400" aria-hidden />} title="Coding mode">
        <ul className="list-inside list-disc space-y-1">
          <li>Switch modes from the header tab bar (Companion ↔ Coding).</li>
          <li>Clone or create repos in the left panel; open files in the editor and chat with the coding agent.</li>
          <li>Enable coding tools in Settings → Tools → Coding mode (v2).</li>
          <li>
            Terminal and Playground run allowlisted commands in the active repo (
            {platform === "windows" ? "cmd.exe" : "sh"} on this system).
          </li>
          <li>
            See <DocLink href={LEGAL_LINKS.codingMode}>CODING-MODE.md</DocLink>{" "}
            for GitHub PAT, templates, and agent tools.
          </li>
        </ul>
      </Section>

      <Section icon={<Cpu className="size-4 text-ps-faint" aria-hidden />} title="Data on your machine">
        {dataDir ? (
          <p className="mb-2 font-mono text-[10px] text-ps-faint" title={dataDir}>
            Data folder: {dataDir.length > 56 ? `…${dataDir.slice(-52)}` : dataDir}
          </p>
        ) : null}
        <ul className="list-inside list-disc space-y-1">
          {platform === "windows" ? (
            <>
              <li>Default: <code className="text-[10px]">%APPDATA%\g00siferdev-py\persistent-sage</code></li>
              <li>Portable: launch with <code className="text-[10px]">Start Persistent Sage (Portable).bat</code></li>
            </>
          ) : platform === "linux" ? (
            <>
              <li>Default: <code className="text-[10px]">~/.local/share/g00siferdev-py/persistent-sage</code></li>
              <li>Portable: set <code className="text-[10px]">PERSISTENT_SAGE_PORTABLE=1</code> before launch</li>
              <li>Custom path: <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code></li>
            </>
          ) : platform === "macos" ? (
            <>
              <li>Default: <code className="text-[10px]">~/Library/Application Support/g00siferdev-py/persistent-sage</code></li>
              <li>Override with <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code></li>
            </>
          ) : (
            <li>Set <code className="text-[10px]">PERSISTENT_SAGE_DATA_DIR</code> to choose a data folder.</li>
          )}
          <li>
            <button
              type="button"
              onClick={() => void invoke("reveal_data_directory")}
              className="inline-flex items-center gap-1 font-medium text-ps-accent hover:underline dark:text-ps-accent"
            >
              <FolderOpen className="size-3" aria-hidden />
              Reveal data folder
            </button>
          </li>
        </ul>
      </Section>

      <section className="space-y-2 rounded-lg border border-ps-border bg-ps-elevated p-3 dark:border-ps-border dark:bg-ps-canvas">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-ps-faint">Documentation</h3>
        <ul className="space-y-1 text-xs">
          <li>
            <DocLink href={LEGAL_LINKS.userGuide}>User guide</DocLink> — day-to-day usage
          </li>
          <li>
            <DocLink href={installDoc}>Install guide</DocLink> — build and first-run setup
          </li>
          <li>
            <DocLink href={LEGAL_LINKS.privacy}>Privacy policy</DocLink>
          </li>
        </ul>
      </section>
    </div>
  );
}
