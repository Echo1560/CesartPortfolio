/**
 * Self-hosted fonts (docs/V3-CONTRACTS.md §4). Build-time only.
 *
 * The curated fonts come from the `@fontsource/*` packages (open licences, no
 * requests to Google Fonts). Only the files the active theme needs are
 * emitted, as static assets under `assets/fonts/` (see `pages/assets/fonts/`).
 * The default theme uses platform fonts and ships none.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fontFaceCss, fontFilesNeeded } from './theme-css';
import type { FontId, ThemeTokens } from './schema-v3';

/** Path of a font file below the site base (`assets/fonts/inter-400.woff2`). */
export function fontAssetPath(font: FontId, weight: number): string {
  return `assets/fonts/${font}-${weight}.woff2`;
}

/** Parses the `[file]` route parameter back to a font and weight. */
export function parseFontFile(file: string): { font: FontId; weight: number } | undefined {
  const m = file.match(/^([a-z0-9-]+)-(\d{3})$/);
  return m ? { font: m[1] as FontId, weight: Number(m[2]) } : undefined;
}

/** The latin-subset woff2 of a font weight, read from node_modules. */
export function readFontFile(font: FontId, weight: number): Buffer {
  return readFileSync(join(process.cwd(), 'node_modules', '@fontsource', font, 'files', `${font}-latin-${weight}-normal.woff2`));
}

/** Route files (`inter-400`) the theme needs. */
export function fontRouteFiles(tokens: ThemeTokens): string[] {
  return fontFilesNeeded(tokens).map(({ font, weight }) => `${font}-${weight}`);
}

/** `@font-face` CSS for the fonts `tokens` uses; `''` for platform fonts only. `base` ends in `/`. */
export function themeFontCss(tokens: ThemeTokens, base: string): string {
  return fontFaceCss(tokens, (font, weight) => base + fontAssetPath(font, weight));
}
