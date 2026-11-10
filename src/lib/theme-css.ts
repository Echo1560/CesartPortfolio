/**
 * Theme tokens -> CSS custom properties (docs/V3-CONTRACTS.md §4).
 *
 * Pure: the public build writes the result into a `<style>` in the head, and the
 * editor (stage 3+) writes the same string into its canvas for live preview.
 * With `DEFAULT_THEME_TOKENS` every variable that `styles/tokens.css` defines
 * gets exactly the value it has there (tested), so the default theme looks like v2.
 *
 * The output only contains values built from enums, numbers and `#rrggbb`
 * colours: `themeTokensSchema` is re-run on the input, so it is safe to inline.
 */
import { themeTokensSchema, type FontId, type Palette, type ThemeTokens } from './schema-v3';

/** CSS family name, generic fallback and the weights the font is available in. */
export interface FontMeta {
  /** `@font-face` family. `null` = a platform stack that needs no download. */
  family: string | null;
  stack: string;
  /** Available weights (all `normal` style, latin subset). */
  weights: readonly number[];
}

const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

export const FONTS: Record<FontId, FontMeta> = {
  // The v2 stacks, byte for byte.
  'system-sans': { family: null, stack: SANS, weights: [] },
  'system-serif': { family: null, stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif", weights: [] },
  inter: { family: 'Inter', stack: `'Inter', ${SANS}`, weights: [300, 400, 500, 600, 700] },
  'dm-sans': { family: 'DM Sans', stack: `'DM Sans', ${SANS}`, weights: [300, 400, 500, 600, 700] },
  'ibm-plex-sans': { family: 'IBM Plex Sans', stack: `'IBM Plex Sans', ${SANS}`, weights: [300, 400, 500, 600, 700] },
  'space-grotesk': { family: 'Space Grotesk', stack: `'Space Grotesk', ${SANS}`, weights: [300, 400, 500, 600, 700] },
  'source-serif-4': { family: 'Source Serif 4', stack: `'Source Serif 4', ${SERIF}`, weights: [300, 400, 500, 600, 700] },
  lora: { family: 'Lora', stack: `'Lora', ${SERIF}`, weights: [400, 500, 600, 700] },
  fraunces: { family: 'Fraunces', stack: `'Fraunces', ${SERIF}`, weights: [300, 400, 500, 600, 700] },
  'playfair-display': { family: 'Playfair Display', stack: `'Playfair Display', ${SERIF}`, weights: [400, 500, 600, 700] },
  'ibm-plex-mono': { family: 'IBM Plex Mono', stack: `'IBM Plex Mono', ${MONO}`, weights: [300, 400, 500, 600, 700] },
};

/** The weight of `font` closest to `wanted` (the font may not ship every weight). */
export function nearestWeight(font: FontId, wanted: number): number {
  const weights = FONTS[font].weights;
  if (weights.length === 0) return wanted;
  return weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), weights[0]);
}

/** Every `(font, weight)` the page needs a file for. System fonts need none. Sorted, unique. */
export function fontFilesNeeded(tokens: ThemeTokens): { font: FontId; weight: number }[] {
  const { headingFont, bodyFont, headingWeight, bodyWeight } = tokens.typography;
  const wanted: [FontId, number][] = [
    [headingFont, headingWeight],
    [bodyFont, bodyWeight],
    [bodyFont, 500], // buttons
    [bodyFont, 700], // bold marks
  ];
  const seen = new Set<string>();
  const out: { font: FontId; weight: number }[] = [];
  for (const [font, w] of wanted) {
    if (FONTS[font].family === null) continue;
    const weight = nearestWeight(font, w);
    const key = `${font}:${weight}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ font, weight });
  }
  return out.sort((a, b) => a.font.localeCompare(b.font) || a.weight - b.weight);
}

const SCALE: Record<ThemeTokens['typography']['scale'], number> = { small: 0.92, medium: 1, large: 1.12 };
const SPACING: Record<ThemeTokens['spacing']['scale'], number> = { compact: 0.8, medium: 1, roomy: 1.25 };

/** v2 text sizes (`tokens.css`). */
const TEXT_SIZES: Record<string, string> = {
  xs: 'clamp(0.75rem, 0.73rem + 0.1vw, 0.8125rem)',
  sm: 'clamp(0.875rem, 0.85rem + 0.12vw, 0.9375rem)',
  base: 'clamp(1rem, 0.97rem + 0.15vw, 1.0625rem)',
  lg: 'clamp(1.125rem, 1.07rem + 0.28vw, 1.3125rem)',
  xl: 'clamp(1.375rem, 1.26rem + 0.55vw, 1.75rem)',
  '2xl': 'clamp(1.75rem, 1.5rem + 1.2vw, 2.5rem)',
  '3xl': 'clamp(2.25rem, 1.8rem + 2.2vw, 3.75rem)',
  '4xl': 'clamp(3rem, 2.1rem + 4.4vw, 6rem)',
};

/** v2 spacing steps that grow and shrink with the spacing scale (the small ones stay put). */
const SPACE_REM: Record<number, number> = { 5: 1.5, 6: 2, 7: 3, 8: 5, 9: 8 };

const RADIUS_REM = { sm: 0.25, md: 0.5, lg: 1 } as const;
const RADIUS_FACTOR: Record<ThemeTokens['radius'], number> = { none: 0, small: 0.5, medium: 1, large: 1.5 };

const num = (n: number) => String(Number(n.toFixed(4)));
const rem = (n: number) => (n === 0 ? '0' : `${num(n)}rem`);

/**
 * `--color-*` are what components use. `--p-*` are copies of the page palette
 * that colour-scheme sections (`.scheme-inverse`, …) read, because those
 * sections redefine `--color-*` for their children.
 */
function palette(p: Palette): Record<string, string> {
  return {
    '--p-bg': p.background,
    '--p-surface': p.surface,
    '--p-text': p.text,
    '--p-accent': p.accent,
    '--p-accent-contrast': p.accentContrast,
    '--color-bg': p.background,
    '--color-surface': p.surface,
    '--color-text': p.text,
    '--color-muted': p.muted,
    '--color-accent': p.accent,
    '--color-accent-contrast': p.accentContrast,
    '--color-border': p.border,
    '--color-focus': p.focus,
  };
}

/** Every custom property the theme sets outside the dark palette. */
export function themeVariables(input: ThemeTokens): Record<string, string> {
  const t = themeTokensSchema.parse(input);
  const { typography: ty } = t;
  const vars: Record<string, string> = { ...palette(t.colors.light) };

  vars['--font-display'] = FONTS[ty.headingFont].stack;
  vars['--font-body'] = FONTS[ty.bodyFont].stack;
  const scale = SCALE[ty.scale];
  for (const [name, size] of Object.entries(TEXT_SIZES)) {
    vars[`--text-${name}`] = scale === 1 ? size : `calc(${size} * ${scale})`;
  }
  vars['--leading-tight'] = num(ty.headingLineHeight);
  vars['--leading-body'] = num(ty.lineHeight);
  vars['--weight-heading'] = String(nearestWeight(ty.headingFont, ty.headingWeight));
  vars['--weight-body'] = String(nearestWeight(ty.bodyFont, ty.bodyWeight));
  vars['--tracking-body'] = `${num(ty.letterSpacing)}em`;
  vars['--tracking-heading'] = `${num(ty.headingLetterSpacing)}em`;
  vars['--heading-case'] = ty.headingCase;

  const spacing = SPACING[t.spacing.scale];
  for (const [step, size] of Object.entries(SPACE_REM)) vars[`--space-${step}`] = rem(size * spacing);

  const factor = RADIUS_FACTOR[t.radius];
  for (const [name, size] of Object.entries(RADIUS_REM)) vars[`--radius-${name}`] = rem(size * factor);

  vars['--btn-radius'] = { square: '0', rounded: 'var(--radius-md)', pill: 'var(--radius-pill)' }[t.buttons.shape];
  vars['--btn-case'] = t.buttons.textCase;

  if (!t.motion.enabled) {
    vars['--motion-scale'] = '0';
    vars['--hover-scale'] = '1';
    vars['--reveal-rise'] = '0px';
  }
  return vars;
}

/**
 * Rules whose variables must resolve on the element itself, so a colour-scheme
 * section that redefines `--color-accent` restyles its buttons and links too.
 */
function themeRules(t: ThemeTokens): string {
  const solid = t.buttons.style === 'solid';
  const btn = solid
    ? ['--btn-bg: var(--color-accent)', '--btn-fg: var(--color-accent-contrast)', '--btn-hover-bg: transparent', '--btn-hover-fg: var(--color-accent)']
    : ['--btn-bg: transparent', '--btn-fg: var(--color-accent)', '--btn-hover-bg: var(--color-accent)', '--btn-hover-fg: var(--color-accent-contrast)'];
  const link = [
    `--link-color: ${t.links.color === 'accent' ? 'var(--color-accent)' : 'inherit'}`,
    `--link-decoration: ${t.links.underline === 'always' ? 'underline' : 'none'}`,
    `--link-decoration-hover: ${t.links.underline === 'none' ? 'none' : 'underline'}`,
  ];
  const decls = (list: string[]) => list.map((d) => `  ${d};`).join('\n');
  return `.btn {\n${decls(btn)}\n}\na {\n${decls(link)}\n}\n`;
}

const block = (vars: Record<string, string>, indent = '') =>
  Object.entries(vars)
    .map(([k, v]) => `${indent}  ${k}: ${v};`)
    .join('\n');

/**
 * `@font-face` rules. `urlFor` returns the file URL, or undefined when the
 * font file is not available (the stack's fallback then applies).
 */
export function fontFaceCss(tokens: ThemeTokens, urlFor: (font: FontId, weight: number) => string | undefined): string {
  return fontFilesNeeded(tokens)
    .flatMap(({ font, weight }) => {
      const url = urlFor(font, weight);
      if (!url) return [];
      return [
        `@font-face {\n  font-family: '${FONTS[font].family}';\n  font-style: normal;\n  font-weight: ${weight};\n  font-display: swap;\n  src: url('${url}') format('woff2');\n}`,
      ];
    })
    .join('\n');
}

/**
 * The theme as CSS. Uses `html:root` so it wins over the defaults in
 * `tokens.css` whatever order the stylesheets load in.
 */
export function themeToCss(input: ThemeTokens): string {
  const t = themeTokensSchema.parse(input);
  const vars = themeVariables(t);
  const light = t.colors.dark === null;
  let css = `html:root {\n  color-scheme: ${light ? 'light' : 'light dark'};\n${block(vars)}\n}\n`;
  if (t.colors.dark) css += `@media (prefers-color-scheme: dark) {\n  html:root {\n${block(palette(t.colors.dark), '  ')}\n  }\n}\n`;
  return css + themeRules(t);
}
