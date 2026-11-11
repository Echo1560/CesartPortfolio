import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME_TOKENS, type ThemeTokens } from '../../src/lib/schema-v3';
import { themeToCss, themeVariables } from '../../src/lib/theme-css';

const tokensCss = readFileSync(new URL('../../src/styles/tokens.css', import.meta.url), 'utf8');

/** `--name: value;` declarations of the first rule whose selector is `selector`. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim().replace(/\s+/g, ' ');
  return out;
}

const withTokens = (patch: (t: ThemeTokens) => void): ThemeTokens => {
  const t = structuredClone(DEFAULT_THEME_TOKENS);
  patch(t);
  return t;
};

describe('themeVariables with the default tokens', () => {
  const v2 = declarations(tokensCss, ':root');
  const vars = themeVariables(DEFAULT_THEME_TOKENS);
  const shared = Object.keys(vars).filter((k) => k in v2);

  it('overlaps tokens.css on the colour, type, space and radius variables', () => {
    expect(shared.length).toBeGreaterThan(25);
    expect(shared).toEqual(expect.arrayContaining(['--color-bg', '--font-display', '--text-4xl', '--space-9', '--radius-lg']));
  });

  it.each(shared.map((k) => [k]))('%s equals its value in tokens.css', (name) => {
    expect(vars[name]).toBe(v2[name]);
  });

  it('does not override the motion variables', () => {
    expect(vars['--motion-scale']).toBeUndefined();
  });
});

describe('themeToCss', () => {
  it('emits the dark palette equal to the dark block of tokens.css', () => {
    const darkBlock = tokensCss.slice(tokensCss.indexOf('@media (prefers-color-scheme: dark)'));
    const v2 = declarations(darkBlock, '  :root');
    const css = themeToCss(DEFAULT_THEME_TOKENS);
    for (const name of ['--color-bg', '--color-surface', '--color-text', '--color-muted', '--color-accent', '--color-accent-contrast', '--color-border', '--color-focus']) {
      expect(css).toContain(`${name}: ${v2[name]};`);
    }
  });

  it('is light only when there is no dark palette', () => {
    const css = themeToCss(withTokens((t) => { t.colors.dark = null; }));
    expect(css).toContain('color-scheme: light;');
    expect(css).not.toContain('prefers-color-scheme');
  });

  it('turns motion off with zeroed variables', () => {
    const css = themeToCss(withTokens((t) => { t.motion.enabled = false; }));
    expect(css).toContain('--motion-scale: 0;');
    expect(css).toContain('--reveal-rise: 0px;');
  });

  it('scales spacing and radius', () => {
    const vars = themeVariables(withTokens((t) => { t.spacing.scale = 'roomy'; t.radius = 'none'; }));
    expect(vars['--space-6']).toBe('2.5rem');
    expect(vars['--radius-md']).toBe('0');
  });

  it('rejects a colour that is not #rrggbb', () => {
    const bad = withTokens((t) => { t.colors.light.accent = 'red;}body{display:none' as never; });
    expect(() => themeToCss(bad)).toThrow();
  });

  // The CSS is inlined into a <style> (Base.astro, editor canvas): no token may close it.
  it.each<[string, (t: ThemeTokens) => void]>([
    ['a colour', (t) => { t.colors.light.text = '#000000</style><script>alert(1)</script>' as never; }],
    ['a dark-palette colour', (t) => { t.colors.dark = { ...t.colors.light, background: '#000;}</style>' as never }; }],
    ['a font id', (t) => { t.typography.bodyFont = "inter'}</style><script>" as never; }],
    ['a heading case', (t) => { t.typography.headingCase = 'none;}</style>' as never; }],
    ['a number', (t) => { t.typography.lineHeight = '1;}</style>' as never; }],
  ])('rejects %s that tries to break out of the <style>', (_, edit) => {
    expect(() => themeToCss(withTokens(edit))).toThrow();
  });

  it('is deterministic', () => {
    expect(themeToCss(DEFAULT_THEME_TOKENS)).toBe(themeToCss(structuredClone(DEFAULT_THEME_TOKENS)));
  });
});
