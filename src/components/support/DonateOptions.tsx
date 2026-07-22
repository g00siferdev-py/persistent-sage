import {
  DONATION_CASHAPP_QR_SRC,
  DONATION_LINKS,
  DONATION_PAYPAL_QR_SRC,
  openExternalUrl,
} from "@/lib/legal";

type Props = {
  /** Show PayPal + Cash App QR codes. */
  showQr?: boolean;
  /** Two-column scan layout for the footer donate popup. */
  qrProminent?: boolean;
  className?: string;
};

function DonateQrColumn({
  label,
  qrSrc,
  qrAlt,
  linkLabel,
  linkUrl,
  linkClassName,
  qrSizeClass,
}: {
  label: string;
  qrSrc: string;
  qrAlt: string;
  linkLabel: string;
  linkUrl: string;
  linkClassName: string;
  qrSizeClass: string;
}) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2.5">
      <p className="text-xs font-semibold text-ps-ink">{label}</p>
      <img
        src={qrSrc}
        alt={qrAlt}
        className={`${qrSizeClass} max-w-full rounded-lg border border-ps-border bg-white p-2 shadow-sm dark:border-ps-border`}
      />
      <a
        href={linkUrl}
        onClick={(e) => {
          e.preventDefault();
          void openExternalUrl(linkUrl);
        }}
        className={`max-w-full truncate text-center text-xs font-medium underline-offset-2 hover:underline ${linkClassName}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        {linkLabel}
      </a>
    </div>
  );
}

export function DonateOptions({ showQr = false, qrProminent = false, className = "" }: Props) {
  const qrSize = qrProminent ? "size-44 sm:size-48" : "size-36";

  return (
    <div className={className}>
      {!showQr ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void openExternalUrl(DONATION_LINKS.paypal)}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-300/60 bg-sky-50 px-2.5 py-1.5 text-xs font-medium text-sky-900 transition hover:bg-sky-100 dark:border-sky-800/50 dark:bg-sky-950/30 dark:text-sky-100 dark:hover:bg-sky-950/50"
          >
            PayPal
          </button>
          <button
            type="button"
            onClick={() => void openExternalUrl(DONATION_LINKS.cashApp)}
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300/60 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-900 transition hover:bg-emerald-100 dark:border-emerald-800/50 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-950/50"
          >
            Cash App {DONATION_LINKS.cashAppTag}
          </button>
        </div>
      ) : null}

      {showQr ? (
        <div
          className={`grid grid-cols-2 ${qrProminent ? "mt-1 gap-8 sm:gap-10" : "mt-3 gap-6"}`}
        >
          <DonateQrColumn
            label="PayPal"
            qrSrc={DONATION_PAYPAL_QR_SRC}
            qrAlt="PayPal QR code for paypal.me/g00sifer"
            linkLabel="paypal.me/g00sifer"
            linkUrl={DONATION_LINKS.paypal}
            linkClassName="text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
            qrSizeClass={qrSize}
          />
          <DonateQrColumn
            label={`Cash App ${DONATION_LINKS.cashAppTag}`}
            qrSrc={DONATION_CASHAPP_QR_SRC}
            qrAlt={`Cash App QR code for ${DONATION_LINKS.cashAppTag}`}
            linkLabel="cash.app/$DG9685"
            linkUrl={DONATION_LINKS.cashApp}
            linkClassName="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300 dark:hover:text-emerald-100"
            qrSizeClass={qrSize}
          />
        </div>
      ) : null}

      {showQr ? (
        <p
          className={`text-[10px] leading-relaxed text-ps-faint ${qrProminent ? "mt-4 text-center" : "mt-3"}`}
        >
          Scan one code at a time with PayPal or Cash App. Voluntary tips only — no features unlocked.
          Microsoft is not affiliated with contributions.
        </p>
      ) : (
        <p className="mt-2 text-[10px] leading-relaxed text-ps-faint">
          Voluntary tips only — no features unlocked. Microsoft is not affiliated with contributions.
        </p>
      )}
    </div>
  );
}
