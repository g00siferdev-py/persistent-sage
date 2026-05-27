import { whatsNewForVersion, type WhatsNewContent } from "@/lib/whatsNew";

type Props = {
  content: WhatsNewContent;
  onDismiss: () => void;
};

export function WhatsNewModal({ content, onDismiss }: Props) {
  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whats-new-title"
    >
      <div className="flex max-h-[min(28rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-100 shadow-2xl dark:bg-slate-900">
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <img
            src="/persistent-sage-splash.png"
            alt=""
            className="mx-auto mb-4 h-20 w-auto object-contain"
          />
          <h2 id="whats-new-title" className="text-center text-xl font-semibold text-slate-900 dark:text-white">
            {content.title}
          </h2>
          <p className="mt-1 text-center text-xs text-slate-500">Version {content.version}</p>
          <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
            {content.highlights.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="border-t border-slate-200 px-6 py-4 dark:border-slate-800">
          <button
            type="button"
            onClick={onDismiss}
            className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildWhatsNewContent(appVersion: string): WhatsNewContent {
  return whatsNewForVersion(appVersion);
}
