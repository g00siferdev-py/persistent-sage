import { invoke } from "@tauri-apps/api/core";

export const REPO_DOCS_BASE =
  "https://github.com/g00siferdev-py/persistent-sage/blob/main";

export const LEGAL_LINKS = {
  privacy: `${REPO_DOCS_BASE}/PRIVACY.md`,
  userGuide: `${REPO_DOCS_BASE}/docs/USER-GUIDE.md`,
  codingMode: `${REPO_DOCS_BASE}/docs/CODING-MODE.md`,
  install: `${REPO_DOCS_BASE}/docs/INSTALL.md`,
  installWindows: `${REPO_DOCS_BASE}/docs/INSTALL-WINDOWS.md`,
  support: `${REPO_DOCS_BASE}/docs/SUPPORT.md`,
  issues: "https://github.com/g00siferdev-py/persistent-sage/issues",
} as const;

/** Third-party voluntary donation links (no in-app digital unlock). */
export const DONATION_LINKS = {
  paypal: "https://www.paypal.com/paypalme/g00sifer",
  cashApp: "https://cash.app/$DG9685",
  cashAppTag: "$DG9685",
} as const;

export const DONATION_PAYPAL_QR_SRC = "/donate-paypal-qr.png";
export const DONATION_CASHAPP_QR_SRC = "/donate-cashapp-qr.png";

/** Open https URLs in the OS browser (Tauri) or a new tab (Vite preview). */
export async function openExternalUrl(url: string): Promise<void> {
  try {
    await invoke("open_external_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

export function openExternalDonation(url: string): void {
  void openExternalUrl(url);
}
