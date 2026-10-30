// Bridge to the Electron shell. Nothing here exists in a plain browser, so every
// call is optional and the page behaves exactly as it does today without it.

import type { ThemeSource } from "./theme";

export type DesktopTheme = {
  /** The setting, not the resolved mode: "system" keeps following the OS. */
  source: ThemeSource;
  /** Resolved --app-bg, so the window never flashes the wrong colour behind the page. */
  background: string;
};

declare global {
  interface Window {
    liquidDesktop?: { setTheme?: (theme: DesktopTheme) => void };
  }
}

export function setDesktopTheme(source: ThemeSource, background: string): void {
  window.liquidDesktop?.setTheme?.({ source, background });
}
