// Themes: one palette, two complete versions of it (light and dark). The data
// lives in themes/palettes.json so the Electron shell and the WCAG checker read
// the same values. The token blocks in styles.css are the pre-JS paint and have
// to match the built-in palette; `npm run themes:check` enforces that.

import registry from "../../themes/palettes.json";

export type ThemeMode = "light" | "dark";
/** What the user picked: a fixed mode, or follow the system. */
export type ThemeSource = ThemeMode | "system";

export type PaletteTokens = Record<string, string>;
export type Palette = {
  name: string;
  light: PaletteTokens;
  dark: PaletteTokens;
  /** WCAG pairs a palette is allowed to miss, with the reason recorded in the file. */
  knownFailures?: string[];
};

type Registry = { version: number; builtin: string; palettes: Record<string, Palette> };

const data = registry as Registry;

export const BUILTIN = data.builtin;
export const PALETTES = data.palettes;

/** Unknown ids fall back to the built-in palette instead of rendering with no tokens. */
export function paletteFor(id: string | undefined): Palette {
  return PALETTES[id ?? BUILTIN] ?? PALETTES[BUILTIN];
}

export function resolveMode(source: ThemeSource, prefersDark: boolean): ThemeMode {
  return source === "system" ? (prefersDark ? "dark" : "light") : source;
}

const applied = new Set<string>();

/**
 * Writes a palette onto the root element as custom properties. Because inline
 * properties outrank the stylesheet, the palette wins over both token blocks;
 * applying no palette restores the stylesheet's built-in colours.
 */
export function applyPalette(root: HTMLElement, tokens: PaletteTokens | undefined): void {
  for (const name of applied) root.style.removeProperty(name);
  applied.clear();
  if (!tokens) return;
  for (const [name, value] of Object.entries(tokens)) {
    if (!name.startsWith("--")) continue;
    root.style.setProperty(name, value);
    applied.add(name);
  }
}
