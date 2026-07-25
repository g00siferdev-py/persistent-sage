import { invoke } from "@tauri-apps/api/core";

export type LinkNavigationAction =
  | { type: "allow" }
  | { type: "block" }
  | { type: "open-external"; url: string };

/**
 * Decide how an anchor click should be handled inside the Tauri webview.
 *
 * Remote http(s) targets must never navigate the main window — that unloads the
 * SPA and drops all in-memory drafts/editor state. Open them in the OS browser
 * instead. Hash-only same-document links stay in-page.
 */
export function classifyAnchorHref(
  href: string | null | undefined,
  pageUrl: string,
): LinkNavigationAction {
  if (href == null) return { type: "allow" };
  const trimmed = href.trim();
  if (!trimmed) return { type: "allow" };

  let resolved: URL;
  let page: URL;
  try {
    page = new URL(pageUrl);
    resolved = new URL(trimmed, page);
  } catch {
    return { type: "block" };
  }

  const sameDocument =
    resolved.origin === page.origin &&
    resolved.pathname === page.pathname &&
    resolved.search === page.search;
  if (sameDocument) {
    return { type: "allow" };
  }

  if (resolved.protocol === "https:" || resolved.protocol === "http:") {
    if (!resolved.hostname) return { type: "block" };
    if (resolved.username || resolved.password) return { type: "block" };
    return { type: "open-external", url: resolved.href };
  }

  // javascript:, file:, data:, etc. — never navigate the app webview.
  return { type: "block" };
}

async function openBrowserUrl(url: string): Promise<void> {
  try {
    await invoke("open_browser_url", { url });
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/** Capture-phase guard so raw <a href> never navigates the main webview away. */
export function installExternalNavigationGuard(
  root: ParentNode = document,
): () => void {
  const onClick = (event: Event) => {
    if (!(event instanceof MouseEvent)) return;
    // Let modified clicks use the browser/OS default (e.g. open in new window).
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const target = event.target;
    if (!(target instanceof Element)) return;
    const anchor = target.closest("a[href]");
    if (!(anchor instanceof HTMLAnchorElement)) return;

    const action = classifyAnchorHref(anchor.getAttribute("href"), window.location.href);
    if (action.type === "allow") return;

    event.preventDefault();
    event.stopPropagation();
    if (action.type === "open-external") {
      void openBrowserUrl(action.url);
    }
  };

  root.addEventListener("click", onClick, true);
  return () => root.removeEventListener("click", onClick, true);
}
