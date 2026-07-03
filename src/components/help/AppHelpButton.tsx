import { useState } from "react";
import { CircleHelp } from "lucide-react";
import { HelpModal } from "@/components/help/HelpModal";

type Props = {
  className?: string;
};

export function AppHelpButton({ className }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          className ??
          "inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
        }
        title="Help — how to use Snowball AI"
        aria-label="Open help"
      >
        <CircleHelp className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Help</span>
      </button>
      <HelpModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
