import { useEffect, useState } from "react";

const NOTE_KEY = "persistent-sage.productivity.notepad";

/** Simple local scratchpad persisted to localStorage. */
export function NotepadWidget() {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(NOTE_KEY) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(NOTE_KEY, text);
      } catch {
        /* ignore */
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [text]);

  return (
    <textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder="Jot anything here — saved automatically on this machine."
      className="h-full w-full resize-none bg-transparent px-4 py-3 font-sans text-xs leading-relaxed text-ps-ink outline-none placeholder:text-ps-faint"
      aria-label="Notepad"
    />
  );
}
