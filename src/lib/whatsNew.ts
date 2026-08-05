export type WhatsNewContent = {
  version: string;
  title: string;
  highlights: string[];
};

/** Release notes shown once after the app version changes (e.g. in-app updater restart). */
const RELEASES: Record<string, WhatsNewContent> = {
  "3.0.0": {
    version: "3.0.0",
    title: "Persistent Sage 3.0 — Moltbook, Productivity, and workspace vision",
    highlights: [
      "Moltbook — companion panel and agent tools for feed, search, posts, and comments (enable in Settings → Tools).",
      "Productivity mode — movable Google Workspace widgets, Email Agent, weather, and local notepad/links.",
      "Favorites and Share — pin favorites; Share menu and richer copy options on chat messages.",
      "Vision — attach from computer, webcam, or workspace; agents can call workspace_view_image on screenshots.",
      "Chat fixes — fenced code blocks render again; companion replies no longer ghost after heavy workspace tool turns.",
      "PDF agent tools, experimental subagents (extra tokens), and Settings tabs (General / Provider / Tools).",
      "Dual updates — Settings → General → Updates works for Microsoft Store and GitHub installs.",
    ],
  },
  "2.1.0": {
    version: "2.1.0",
    title: "Persistent Sage 2.1.0 — UX polish",
    highlights: [
      "Companion UX — message timestamps, improved markdown, copy buttons, Help menu, token counter, abort turn.",
      "Coding panels — notepad, code playground, Agent Action Stream, Event Stream Debugger, Settings in coding mode.",
      "Light/dark theme support for artifacts; unified conversation when switching Companion ↔ Coding.",
      "Cache manager in Settings; single-instance guard; ErrorBoundary for recoverable UI errors.",
      "Optional donations (PayPal / Cash App) in footer and onboarding — voluntary, no feature unlock.",
      "Version badge shows v2.1.0; Windows playground bash uses Git Bash instead of the WSL launcher.",
    ],
  },
  "2.0.0": {
    version: "2.0.0",
    title: "Persistent Sage 2.0 — Coding mode",
    highlights: [
      "Coding mode — manage git repos under workspace/repos with a built-in editor and terminal.",
      "New project templates — empty, Rust, Node.js, Python, Tauri, and C# starters.",
      "Coding agent tools — grep, patch, allowlisted shell, local git, and HTTPS remote via encrypted GitHub PAT.",
      "Companion link — optional shared persona and memory between chat and coding (code filtered from anchors).",
      "Split, Editor, or Chat views plus a resizable terminal with live agent command output.",
    ],
  },
  "1.0.0": {
    version: "1.0.0",
    title: "Persistent Sage 1.0",
    highlights: [
      "Chat artifacts — HTML reports, inline charts, tables, and interactive forms rendered in the chat window.",
      "Collaborative projects — living documents under workspace/projects with project tools and cross-companion memory.",
      "Browser fetch — headless Chrome for news sites and JS-heavy pages (CNN, MSNBC, and more).",
      "Dual update paths — Microsoft Store installs update through the Store; GitHub installs use the signed Tauri updater.",
      "Pulse, memory anchor, agent tools, and multi-provider chat — all under the Persistent Sage name.",
    ],
  },
  "0.2.0-beta.9": {
    version: "0.2.0-beta.9",
    title: "What's new!",
    highlights: [
      "Pulse — scheduled background check-ins using your open chat thread, with tools when enabled in Settings.",
      "Send Pulse now — run a check-in immediately from Settings → General.",
      "Pulse replies appear in chat as “Pulse Response : [timestamp] - …” (your instructions stay hidden).",
      "OpenAI API key save fix; separate model lists for local Ollama vs Ollama Cloud.",
      "Microsoft Store MSIX packaging workflow and expanded privacy policy.",
    ],
  },
};

export function whatsNewForVersion(version: string): WhatsNewContent {
  const key = version.trim();
  return (
    RELEASES[key] ?? {
      version: key,
      title: "What's new!",
      highlights: [
        `Persistent Sage ${key} is installed.`,
        "See the changelog on GitHub for full release notes.",
      ],
    }
  );
}
