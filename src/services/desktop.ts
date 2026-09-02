/**
 * Desktop (Electron) bridge accessor.
 *
 * The React code is unchanged when it runs in a browser: `isDesktop()` is false and
 * every helper here degrades to the previous web behavior. Inside the Electron shell
 * these values come from electron/preload.cjs via contextBridge.
 */
interface DesktopBridge {
  isDesktop: boolean;
  /** Backend API base resolved at runtime, e.g. "http://127.0.0.1:5000/api". */
  apiBase: string;
  openExternal: (url: string) => Promise<boolean>;
}

function bridge(): DesktopBridge | undefined {
  return typeof window === 'undefined' ? undefined : (window as any).desktop;
}

/** True only when running inside the packaged desktop application. */
export function isDesktop(): boolean {
  return !!bridge()?.isDesktop;
}

/**
 * API base the desktop shell told us to use. Empty string in a browser, so callers
 * fall back to the build-time VITE_API_BASE_URL exactly as before.
 */
export function desktopApiBase(): string {
  return bridge()?.apiBase || '';
}

/**
 * Open a URL in the user's normal browser (Chrome/Edge/...). Used for Google
 * sign-in, which Google refuses to render inside an embedded app window.
 * Falls back to a normal navigation when not running in the desktop shell.
 */
export function openExternal(url: string): void {
  const b = bridge();
  if (b?.openExternal) {
    void b.openExternal(url);
    return;
  }
  window.location.href = url;
}
