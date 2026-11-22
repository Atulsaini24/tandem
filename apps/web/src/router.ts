import { useSyncExternalStore } from "react";

/**
 * A tiny client-side router: three routes don't need a library.
 *
 *   /            the homepage (scroll story)
 *   /boards      your boards + templates
 *   /b/:id       a board (?template=… fills a new one, ?mode=view opens it read-only)
 */
export type Route =
  | { readonly page: "home" }
  | { readonly page: "boards" }
  | { readonly page: "board"; readonly docId: string; readonly template?: string; readonly viewMode: boolean; readonly token?: string };

const DOC_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(pathname: string, search: string): Route {
  const params = new URLSearchParams(search);
  const legacy = params.get("doc"); // old links: /?doc=<id>
  if (pathname === "/" && legacy && DOC_ID.test(legacy)) return board(legacy, params);
  if (pathname === "/boards" || pathname === "/boards/") return { page: "boards" };
  const match = /^\/b\/([^/]+)\/?$/.exec(pathname);
  if (match?.[1] && DOC_ID.test(decodeURIComponent(match[1]))) return board(decodeURIComponent(match[1]), params);
  return { page: "home" };
}

function board(docId: string, params: URLSearchParams): Route {
  const template = params.get("template") ?? undefined;
  const token = params.get("token") ?? undefined;
  return {
    page: "board",
    docId,
    viewMode: params.get("mode") === "view",
    ...(template ? { template } : {}),
    ...(token ? { token } : {}),
  };
}

const listeners = new Set<() => void>();
let current = typeof location === "undefined" ? "/" : location.pathname + location.search;

function notify(): void {
  current = location.pathname + location.search;
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") window.addEventListener("popstate", notify);

export function navigate(to: string, options: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  if (options.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  notify();
  window.scrollTo(0, 0);
}

export function useRoute(): Route {
  const href = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
  const url = new URL(href, "http://x");
  return parseRoute(url.pathname, url.search);
}

/** An <a> that navigates without a reload (and still works with ctrl/middle click). */
export function linkProps(to: string): { href: string; onClick: (e: React.MouseEvent) => void } {
  return {
    href: to,
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
