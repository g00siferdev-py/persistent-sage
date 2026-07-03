const pad2 = (n: number) => n.toString().padStart(2, "0");

function formatDateTimeParts(d: Date, utc: boolean): {
  month: string;
  day: string;
  year: string;
  hour12: string;
  minute: string;
  second: string;
  ampm: string;
} {
  const month = pad2(utc ? d.getUTCMonth() + 1 : d.getMonth() + 1);
  const day = pad2(utc ? d.getUTCDate() : d.getDate());
  const year = (utc ? d.getUTCFullYear() : d.getFullYear()).toString();
  let hour = utc ? d.getUTCHours() : d.getHours();
  const ampm = hour >= 12 ? "PM" : "AM";
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return {
    month,
    day,
    year,
    hour12: hour.toString(),
    minute: pad2(utc ? d.getUTCMinutes() : d.getMinutes()),
    second: pad2(utc ? d.getUTCSeconds() : d.getSeconds()),
    ampm,
  };
}

function formatDateTime(d: Date, utc = false): string {
  const p = formatDateTimeParts(d, utc);
  return `${p.month}/${p.day}/${p.year}, ${p.hour12}:${p.minute}:${p.second} ${p.ampm}`;
}

/** Best-effort local timezone abbreviation from the environment.
 *  Uses Date.toString() because Intl.DateTimeFormat may have broken ICU data in the webview.
 */
function getLocalTimezoneAbbr(): string {
  try {
    const str = new Date().toString();
    const match = str.match(/\(([^)]+)\)$/);
    if (match) {
      const zone = match[1];
      // For long names like "Eastern Daylight Saving Time", take initials.
      if (zone.includes(" ")) {
        return zone
          .split(" ")
          .map((w) => w[0])
          .join("")
          .toUpperCase();
      }
      return zone;
    }
  } catch {
    // fall through
  }
  // Fallback: compute offset string like GMT-0400
  const offset = new Date().getTimezoneOffset();
  const sign = offset <= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const h = Math.floor(abs / 60)
    .toString()
    .padStart(2, "0");
  const m = (abs % 60).toString().padStart(2, "0");
  return `GMT${sign}${h}${m}`;
}

/** Format an ISO-8601 timestamp into the user's requested display:
 *  "You - 06/23/2026, 5:09:30 pm EDT - 06/23/2026, 9:09:30 PM UTC"
 *
 * createdAt is stored as an ISO-8601 UTC string (from new Date().toISOString()).
 * We display it in the user's local timezone and again in UTC.
 */
/** SQLite CURRENT_TIMESTAMP returns "YYYY-MM-DD HH:MM:SS" in UTC but without a timezone.
 *  JavaScript Date.parse treats that as local time, so we must append Z to treat it as UTC.
 */
function parseStoredTimestamp(value?: string): Date {
  if (!value) return new Date();
  const trimmed = value.trim();
  // SQLite format: "2026-06-23 21:35:48" -> treat as UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed.replace(" ", "T") + "Z");
  }
  return new Date(trimmed);
}

export function formatChatHeader(
  label: string,
  isoTimestamp?: string,
): string {
  const date = parseStoredTimestamp(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    return `${label} - ${formatDateTime(now)} ${getLocalTimezoneAbbr()} - ${formatDateTime(now, true)} UTC`;
  }

  // Local time: use the Date constructor's local interpretation of the timestamp.
  const localStr = formatDateTime(date);
  const localZone = getLocalTimezoneAbbr();

  // UTC time: use the UTC getters.
  const utcStr = formatDateTime(date, true);

  return `${label} - ${localStr} ${localZone} - ${utcStr} UTC`;
}
