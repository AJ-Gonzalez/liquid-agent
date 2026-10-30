// Checks the theme contract: every palette is a complete set of colour tokens
// for both modes, the built-in palette still matches the values in styles.css
// (they paint the app before JS runs), and every text/UI pair meets its WCAG
// minimum. Run with `npm run themes:check`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CSS = path.join(ROOT, "web", "src", "styles.css");
const PALETTES = path.join(ROOT, "themes", "palettes.json");

/** Tokens that are not colours, so a palette has no say over them. */
const NOT_COLOUR = new Set(["--mono", "--shadow", "--shadow-lg"]);

/**
 * [foreground, background, minimum ratio, why].
 * 7:1 is AAA body text, 4.5:1 is AA normal text, 3:1 is AA non-text UI.
 */
const CHECKS = [
  ["--fg", "--bg", 7, "body text on the work surface"],
  ["--fg", "--panel", 7, "body text on a panel"],
  ["--fg", "--app-bg", 7, "sidebar text on the frame"],
  ["--fg", "--bubble", 7, "message text in a bubble"],
  ["--fg", "--code-bg", 7, "text in a code block"],
  ["--fg-2", "--bg", 4.5, "secondary text"],
  ["--fg-2", "--panel", 4.5, "secondary text on a panel"],
  ["--fg-2", "--app-bg", 4.5, "secondary text on the frame"],
  ["--fg-3", "--bg", 4.5, "muted text"],
  ["--fg-3", "--panel", 4.5, "muted text on a panel"],
  ["--fg-3", "--app-bg", 4.5, "muted text on the frame"],
  ["--accent-text", "--bg", 4.5, "links and accent labels"],
  ["--accent-text", "--panel", 4.5, "links and accent labels on a panel"],
  ["--danger", "--bg", 4.5, "errors and destructive labels"],
  ["--danger", "--panel", 4.5, "errors and destructive labels on a panel"],
  ["--ok", "--bg", 4.5, "success labels"],
  ["--ok", "--panel", 4.5, "success labels on a panel"],
  ["--warn", "--bg", 4.5, "warning labels"],
  ["--warn", "--panel", 4.5, "warning labels on a panel"],
  ["--accent", "--bg", 3, "accent fills: toggles, progress, status dots"],
];

const problems = [];
const fail = (message) => problems.push(message);

// ---- Read the stylesheet's two token blocks ----

const css = fs.readFileSync(CSS, "utf8");
const blocks = [...css.matchAll(/:root[^{]*\{([^}]*)\}/g)].map((m) => m[1]);
if (blocks.length < 2) fail(`${path.relative(ROOT, CSS)}: expected light and dark token blocks.`);

const readTokens = (block) =>
  Object.fromEntries(
    [...block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
      .filter(([, name]) => !NOT_COLOUR.has(name))
      .map(([, name, value]) => [name, value.trim().replace(/\s+/g, " ")]),
  );

const cssLight = blocks[0] ? readTokens(blocks[0]) : {};
const cssDark = blocks[1] ? readTokens(blocks[1]) : {};
const expected = Object.keys(cssLight).sort();

for (const name of expected) {
  if (!(name in cssDark)) fail(`styles.css: ${name} is in the light block but not the dark block.`);
}

// ---- Read and validate the palette registry ----

const registry = JSON.parse(fs.readFileSync(PALETTES, "utf8"));
if (registry.version !== 1) fail(`themes/palettes.json: unsupported version ${registry.version}.`);
if (!registry.palettes?.[registry.builtin]) fail(`themes/palettes.json: builtin "${registry.builtin}" is missing.`);

// ---- Colour maths ----

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function parseColour(input) {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = [...digits].map((d) => d + d).join("");
    if (digits.length !== 6 && digits.length !== 8) throw new Error(`unsupported hex length: ${input}`);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16) / 255);
    const a = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r, g, b, a };
  }
  const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
  if (rgb) {
    const parts = rgb[1].split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) throw new Error(`unsupported colour: ${input}`);
    const channel = (p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p));
    const alpha = (p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p));
    const [r, g, b] = parts.slice(0, 3).map((p) => clamp(channel(p), 0, 255) / 255);
    const a = parts[3] === undefined ? 1 : clamp(alpha(parts[3]), 0, 1);
    return { r, g, b, a };
  }
  throw new Error(`unsupported colour (use hex or rgb/rgba): ${input}`);
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// ---- Per-palette checks ----

const report = [];

for (const [id, palette] of Object.entries(registry.palettes ?? {})) {
  if (typeof palette.name !== "string" || !palette.name.trim()) fail(`${id}: needs a display name.`);
  const declared = new Set(palette.knownFailures ?? []);

  for (const mode of ["light", "dark"]) {
    const tokens = palette[mode];
    if (!tokens || typeof tokens !== "object") {
      fail(`${id}: missing the ${mode} version.`);
      continue;
    }

    const keys = Object.keys(tokens).sort();
    for (const name of expected) if (!keys.includes(name)) fail(`${id} ${mode}: missing ${name}.`);
    for (const name of keys) {
      if (!expected.includes(name)) fail(`${id} ${mode}: ${name} is not a token in styles.css.`);
      try {
        parseColour(tokens[name]);
      } catch (e) {
        fail(`${id} ${mode}: ${name} — ${e.message}`);
      }
    }

    if (id === registry.builtin) {
      const cssTokens = mode === "light" ? cssLight : cssDark;
      for (const name of expected) {
        const fromCss = cssTokens[name];
        const fromJson = tokens[name];
        if (fromCss && fromJson && fromCss.toLowerCase() !== fromJson.trim().toLowerCase()) {
          fail(`${id} ${mode}: ${name} is ${fromJson} but styles.css says ${fromCss}. Keep them equal.`);
        }
      }
    }

    const rows = [];
    for (const [fgName, bgName, min, why] of CHECKS) {
      const fgValue = tokens[fgName];
      const bgValue = tokens[bgName];
      if (!fgValue || !bgValue) continue;
      let value;
      try {
        const bg = parseColour(bgValue);
        const fg = parseColour(fgValue);
        value = ratio(over(fg, bg), bg);
      } catch {
        continue; // already reported as an unparseable colour
      }
      const key = `${mode}:${fgName.slice(2)}:${bgName.slice(2)}`;
      const ok = value + 1e-9 >= min;
      const exempt = declared.has(key);
      if (exempt) declared.delete(key);
      if (!ok && !exempt) fail(`${id} ${mode}: ${fgName.slice(2)} on ${bgName.slice(2)} is ${value.toFixed(2)}:1, needs ${min}:1 (${why}).`);
      if (ok && exempt) fail(`${id} ${mode}: ${key} no longer fails ${min}:1 (${value.toFixed(2)}:1), so drop it from knownFailures.`);
      rows.push({ key, fgName, bgName, min, value, ok, exempt });
    }
    report.push({ id, name: palette.name, mode, rows });
  }

  for (const leftover of declared) fail(`${id}: knownFailures names an unknown pair: ${leftover}.`);
}

// ---- Report ----

if (report.length) {
  for (const { name, mode, rows } of report) {
    console.log(`\n${name} · ${mode}`);
    for (const row of rows) {
      const ratioText = `${row.value.toFixed(2)}:1`.padStart(8);
      const need = `${row.min}:1`.padStart(5);
      const verdict = row.ok ? "pass" : row.exempt ? "known" : "FAIL";
      console.log(`  ${verdict}  ${row.fgName.slice(2)} on ${row.bgName.slice(2)}`.padEnd(40) + `${ratioText}  min ${need}`);
    }
  }
  console.log("");
}

if (problems.length) {
  for (const problem of problems) console.error(`✗ ${problem}`);
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} in the theme contract.`);
  process.exit(1);
}

const modes = report.length;
console.log(`✓ ${modes} palette mode${modes === 1 ? "" : "s"} match the contract and meet WCAG.`);
