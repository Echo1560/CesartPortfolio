/**
 * WCAG 2.x contrast for the theme editor's AA warnings. Pure; no DOM.
 */
import type { Palette } from './schema-v3';

/** Relative luminance of a `#rrggbb` colour (WCAG 2.x). */
export function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/** Contrast ratio of two `#rrggbb` colours, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

export interface ContrastPair {
  /** Palette keys: foreground, then background. */
  fg: keyof Palette;
  bg: keyof Palette;
  label: string;
  /** Minimum ratio: 4.5 for text, 3 for UI such as the focus ring. */
  min: number;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  { fg: 'text', bg: 'background', label: 'Text on background', min: 4.5 },
  { fg: 'text', bg: 'surface', label: 'Text on surface', min: 4.5 },
  { fg: 'muted', bg: 'background', label: 'Muted text on background', min: 4.5 },
  { fg: 'muted', bg: 'surface', label: 'Muted text on surface', min: 4.5 },
  { fg: 'accent', bg: 'background', label: 'Accent (links, outline buttons) on background', min: 4.5 },
  { fg: 'accentContrast', bg: 'accent', label: 'Button text on accent', min: 4.5 },
  { fg: 'focus', bg: 'background', label: 'Focus ring on background', min: 3 },
];

export interface ContrastIssue extends ContrastPair {
  ratio: number;
}

/** The pairs of `palette` that miss WCAG AA, worst first. */
export function contrastIssues(palette: Palette): ContrastIssue[] {
  return CONTRAST_PAIRS.map((p) => ({ ...p, ratio: contrastRatio(palette[p.fg], palette[p.bg]) }))
    .filter((p) => p.ratio < p.min)
    .sort((a, b) => a.ratio / a.min - b.ratio / b.min);
}
