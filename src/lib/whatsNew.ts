export type WhatsNewContent = {
  version: string;
  title: string;
  highlights: string[];
};

/** Release notes shown once after the app version changes (e.g. in-app updater restart). */
const RELEASES: Record<string, WhatsNewContent> = {
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
