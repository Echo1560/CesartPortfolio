import { describe, expect, it } from 'vitest';
import { contrastIssues, contrastRatio, luminance } from '../../src/lib/contrast';
import { DEFAULT_THEME_TOKENS, type Palette } from '../../src/lib/schema-v3';

const palette = (over: Partial<Palette> = {}): Palette => ({ ...DEFAULT_THEME_TOKENS.colors.light, ...over });

describe('luminance', () => {
  it('is 0 for black and 1 for white', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 10);
  });

  it('weights green above red above blue', () => {
    expect(luminance('#00ff00')).toBeGreaterThan(luminance('#ff0000'));
    expect(luminance('#ff0000')).toBeGreaterThan(luminance('#0000ff'));
  });

  it('uses the linear segment for very dark channels', () => {
    expect(luminance('#030303')).toBeCloseTo(3 / 255 / 12.92, 6);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white, in either order', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 5);
  });

  it('is 1 for identical colours', () => {
    expect(contrastRatio('#7a2e8e', '#7a2e8e')).toBe(1);
  });

  it('matches the known WCAG value for #767676 on white (4.54:1)', () => {
    expect(contrastRatio('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
});

describe('contrastIssues', () => {
  it('reports nothing for the default palettes', () => {
    expect(contrastIssues(DEFAULT_THEME_TOKENS.colors.light)).toEqual([]);
    if (DEFAULT_THEME_TOKENS.colors.dark) expect(contrastIssues(DEFAULT_THEME_TOKENS.colors.dark)).toEqual([]);
  });

  it('flags text that matches the background, with the 4.5 minimum and the ratio', () => {
    const issues = contrastIssues(palette({ text: '#f6f5f2', background: '#f6f5f2', surface: '#ffffff' }));
    const hit = issues.find((i) => i.fg === 'text' && i.bg === 'background');
    expect(hit).toMatchObject({ min: 4.5, ratio: 1 });
  });

  it('checks the focus ring against 3:1, not 4.5:1', () => {
    // #8a8a8a on white is about 3.5:1: fine for a UI component, too low for text.
    expect(contrastIssues(palette({ background: '#ffffff', focus: '#8a8a8a' })).find((i) => i.fg === 'focus')).toBeUndefined();
    expect(contrastIssues(palette({ background: '#ffffff', focus: '#cccccc' })).find((i) => i.fg === 'focus')?.min).toBe(3);
  });

  it('sorts the worst pair first', () => {
    const issues = contrastIssues(palette({ text: '#ffffff', background: '#ffffff', muted: '#888888' }));
    expect(issues.length).toBeGreaterThan(1);
    const score = (i: (typeof issues)[number]) => i.ratio / i.min;
    expect(issues.map(score)).toEqual([...issues.map(score)].sort((a, b) => a - b));
  });

  it('flags button text that is unreadable on the accent colour', () => {
    const issues = contrastIssues(palette({ accent: '#111111', accentContrast: '#222222' }));
    expect(issues.map((i) => i.fg)).toContain('accentContrast');
  });
});
