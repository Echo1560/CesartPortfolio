import { describe, expect, it } from 'vitest';
import { contrastIssues } from '../../src/lib/contrast';
import { DEFAULT_THEME_TOKENS, themeTokensSchema } from '../../src/lib/schema-v3';
import { THEME_PRESET_LIST, presetById } from '../../src/lib/theme-presets';
import { themeToCss } from '../../src/lib/theme-css';

describe('theme presets', () => {
  it('offers three to five presets with unique ids, including the v2 default', () => {
    expect(THEME_PRESET_LIST.length).toBeGreaterThanOrEqual(3);
    expect(THEME_PRESET_LIST.length).toBeLessThanOrEqual(5);
    expect(new Set(THEME_PRESET_LIST.map((p) => p.id)).size).toBe(THEME_PRESET_LIST.length);
    expect(presetById('classic')?.tokens).toEqual(DEFAULT_THEME_TOKENS);
  });

  it('returns undefined for an unknown preset id', () => {
    expect(presetById('nope')).toBeUndefined();
  });

  describe.each(THEME_PRESET_LIST.map((p) => [p.id, p] as const))('%s', (_id, preset) => {
    it('is valid against the theme schema', () => {
      expect(themeTokensSchema.safeParse(preset.tokens).success).toBe(true);
    });

    it('has AA-clean light colours', () => {
      expect(contrastIssues(preset.tokens.colors.light)).toEqual([]);
    });

    it('has AA-clean dark colours when it defines them', () => {
      const dark = preset.tokens.colors.dark;
      if (dark) expect(contrastIssues(dark)).toEqual([]);
    });

    it('renders to CSS', () => {
      expect(themeToCss(preset.tokens)).toContain('--color-accent');
    });
  });
});
