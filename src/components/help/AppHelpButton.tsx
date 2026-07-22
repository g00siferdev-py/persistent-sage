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
          "ps-btn"
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
