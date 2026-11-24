import { useSyncExternalStore } from "react";

/**
 * Installable app: the service worker (public/sw.js) caches the app shell so Tandem opens
 * without a network, and the browser's install prompt is kept so our own "Install app"
 * button can show it at a good moment.
 */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPrompt | undefined;
const listeners = new Set<() => void>();
const notify = (): void => {
  for (const l of listeners) l();
};

export function registerPwa(): void {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallPrompt;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = undefined;
    notify();
  });
  // Dev keeps Vite's live reload honest: no worker caching modules under it.
  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch((error: unknown) => console.warn("service worker failed", error));
    });
  }
}

/** True when the browser has offered to install the app (and it isn't installed yet). */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => deferred !== undefined,
  );
}

export async function installApp(): Promise<boolean> {
  const prompt = deferred;
  if (!prompt) return false;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  deferred = undefined;
  notify();
  return outcome === "accepted";
}

export const isInstalled = (): boolean => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
