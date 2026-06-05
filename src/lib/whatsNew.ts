export type WhatsNewContent = {
  version: string;
  title: string;
  highlights: string[];
};

/** Release notes shown once after the app version changes (e.g. in-app updater restart). */
const RELEASES: Record<string, WhatsNewContent> = {
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
