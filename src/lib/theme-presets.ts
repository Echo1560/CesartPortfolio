/**
 * Theme presets (docs/V3-CONTRACTS.md §4). Code, not rows: choosing one copies its
 * tokens into `theme.tokens`. Every preset passes `contrastIssues()` in both palettes.
 */
import { DEFAULT_THEME_TOKENS, type ThemePresetId, type ThemeTokens } from './schema-v3';

export interface ThemePreset {
  id: ThemePresetId;
  label: string;
  description: string;
  tokens: ThemeTokens;
}

const base = DEFAULT_THEME_TOKENS;
const make = (over: Partial<Omit<ThemeTokens, 'typography'>> & { typography?: Partial<ThemeTokens['typography']> }): ThemeTokens => ({
  ...structuredClone(base),
  ...over,
  typography: { ...base.typography, ...over.typography },
});

export const THEME_PRESET_LIST: readonly ThemePreset[] = [
  { id: 'classic', label: 'Classic', description: 'The original look: warm paper, serif headings, pill buttons.', tokens: structuredClone(base) },
  {
    id: 'noir',
    label: 'Noir',
    description: 'Dark gallery wall, uppercase grotesk headings, outline buttons.',
    tokens: make({
      colors: {
        light: { background: '#101010', surface: '#1a1a1a', text: '#f2f0ea', muted: '#b0aea6', accent: '#f2c14e', accentContrast: '#101010', border: '#333333', focus: '#8fb8ff' },
        dark: null,
      },
      typography: { headingFont: 'space-grotesk', bodyFont: 'inter', headingWeight: 600, headingCase: 'uppercase', headingLetterSpacing: 0.04, headingLineHeight: 1.05 },
      buttons: { shape: 'square', style: 'outline', textCase: 'uppercase' },
      radius: 'none',
      links: { underline: 'hover', color: 'accent' },
    }),
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Black on white, editorial serif, quiet and spacious.',
    tokens: make({
      colors: {
        light: { background: '#ffffff', surface: '#f4f4f2', text: '#111111', muted: '#55554f', accent: '#111111', accentContrast: '#ffffff', border: '#d8d8d4', focus: '#1a5fd0' },
        dark: null,
      },
      typography: { headingFont: 'playfair-display', bodyFont: 'source-serif-4', headingWeight: 500, lineHeight: 1.7 },
      spacing: { scale: 'roomy' },
      buttons: { shape: 'square', style: 'solid', textCase: 'none' },
      radius: 'small',
      links: { underline: 'always', color: 'text' },
    }),
  },
  {
    id: 'meadow',
    label: 'Meadow',
    description: 'Soft greens, friendly serif headings, rounded corners.',
    tokens: make({
      colors: {
        light: { background: '#f3f6ef', surface: '#ffffff', text: '#1f2a1f', muted: '#4f5d4f', accent: '#2f6b3a', accentContrast: '#ffffff', border: '#d4dccd', focus: '#1a5fd0' },
        dark: { background: '#121a13', surface: '#1b261c', text: '#e8efe4', muted: '#a5b3a1', accent: '#8fd19a', accentContrast: '#121a13', border: '#2f3d30', focus: '#8fb8ff' },
      },
      typography: { headingFont: 'lora', bodyFont: 'dm-sans', headingWeight: 600 },
      buttons: { shape: 'rounded', style: 'solid', textCase: 'none' },
      radius: 'large',
      links: { underline: 'hover', color: 'accent' },
    }),
  },
  {
    id: 'citrus',
    label: 'Citrus',
    description: 'Warm cream and burnt orange, bold display type, roomy layout.',
    tokens: make({
      colors: {
        light: { background: '#fffaf0', surface: '#ffffff', text: '#2b2118', muted: '#6b5a4a', accent: '#b4440e', accentContrast: '#ffffff', border: '#eadfca', focus: '#1a5fd0' },
        dark: null,
      },
      typography: { headingFont: 'fraunces', bodyFont: 'ibm-plex-sans', headingWeight: 700, headingLineHeight: 1.05, headingLetterSpacing: -0.02 },
      spacing: { scale: 'roomy' },
      buttons: { shape: 'pill', style: 'solid', textCase: 'none' },
      radius: 'large',
      links: { underline: 'always', color: 'accent' },
    }),
  },
];

export const presetById = (id: string): ThemePreset | undefined => THEME_PRESET_LIST.find((p) => p.id === id);
