import { useEffect, useState } from "react";

const TZ_KEY = "persistent-sage.productivity.clock.secondTz";

function loadTz(): string {
  try {
    return localStorage.getItem(TZ_KEY) ?? "";
  } catch {
    return "";
  }
}

function formatInTz(date: Date, timeZone: string | undefined, opts: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: timeZone || undefined }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(date);
  }
}

/** Local clock with optional second timezone. */
export function ClockWidget() {
  const [now, setNow] = useState(() => new Date());
  const [secondTz, setSecondTz] = useState(loadTz);
  const [tzDraft, setTzDraft] = useState(loadTz);

  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const localTime = formatInTz(now, undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
  const localDate = formatInTz(now, undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  let secondTime: string | null = null;
  let secondLabel: string | null = null;
  if (secondTz.trim()) {
    secondTime = formatInTz(now, secondTz.trim(), {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    });
    secondLabel = secondTz.trim();
  }

  return (
    <div className="flex h-full flex-col justify-between gap-3 p-4">
      <div>
        <p className="ps-label">Local</p>
        <p className="mt-1 font-display text-3xl font-semibold tracking-tight text-ps-ink tabular-nums">
          {localTime}
        </p>
        <p className="mt-1 text-xs text-ps-muted">{localDate}</p>
      </div>
      {secondTime ? (
        <div>
          <p className="ps-label">{secondLabel}</p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-ps-ink">{secondTime}</p>
        </div>
      ) : null}
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          const v = tzDraft.trim();
          setSecondTz(v);
          try {
            localStorage.setItem(TZ_KEY, v);
          } catch {
            /* ignore */
          }
        }}
      >
        <input
          className="ps-input min-w-0 flex-1 px-2 py-1.5 font-mono text-[11px]"
          placeholder="Second TZ e.g. America/New_York"
          value={tzDraft}
          onChange={(e) => setTzDraft(e.target.value)}
          aria-label="Second timezone"
        />
        <button type="submit" className="ps-btn px-2 py-1.5 text-[11px]">
          Set
        </button>
      </form>
    </div>
  );
}
