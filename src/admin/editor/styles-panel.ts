/**
 * Site styles panel: presets, colours, typography, buttons, links, spacing, corner
 * radius and motion. Every change goes through `store.editTheme`, which updates the
 * canvas live and autosaves to the `theme` row (docs/V3-CONTRACTS.md §4).
 */
import { FONT_IDS, type FontId, type Palette, type ThemeTokens } from '../../lib/schema-v3';
import { contrastIssues } from '../../lib/contrast';
import { presetById, THEME_PRESET_LIST } from '../../lib/theme-presets';
import { checkbox, clear, field, h, select } from '../dom';
import type { EditorStore } from './store';

export interface StylesPanel {
  render(): void;
}

type Typography = ThemeTokens['typography'];

const FONT_LABEL: Record<FontId, string> = {
  'system-sans': 'System sans',
  'system-serif': 'System serif',
  inter: 'Inter',
  'dm-sans': 'DM Sans',
  'ibm-plex-sans': 'IBM Plex Sans',
  'space-grotesk': 'Space Grotesk',
  'source-serif-4': 'Source Serif 4',
  lora: 'Lora',
  fraunces: 'Fraunces',
  'playfair-display': 'Playfair Display',
  'ibm-plex-mono': 'IBM Plex Mono',
};

const PALETTE_ROLES: [keyof Palette, string][] = [
  ['background', 'Background'],
  ['surface', 'Surface'],
  ['text', 'Text'],
  ['muted', 'Muted text'],
  ['accent', 'Accent'],
  ['accentContrast', 'Text on accent'],
  ['border', 'Border'],
  ['focus', 'Focus ring'],
];

const HEX = /^#[0-9a-f]{6}$/;

export function createStylesPanel(host: HTMLElement, store: EditorStore): StylesPanel {
  const set = (fn: (t: ThemeTokens) => void, key: string) => store.editTheme((theme) => fn(theme.tokens), key);

  /** A select bound to a token. */
  const choice = <T extends string | number>(label: string, options: [T, string][], get: () => T, put: (v: T) => void, key: string, hint?: string) => {
    const el = select(options.map(([v, l]) => [String(v), l]), String(get()));
    el.addEventListener('change', () => {
      const picked = options.find(([v]) => String(v) === el.value)?.[0];
      if (picked !== undefined) set(() => put(picked), key);
    });
    return field(label, el, hint).el;
  };

  /** A number input bound to a token (range-limited by the schema). */
  const number = (label: string, min: number, max: number, step: number, get: () => number, put: (v: number) => void, key: string) => {
    const el = h('input', { type: 'number', min, max, step, value: get() });
    el.addEventListener('input', () => {
      const v = el.valueAsNumber;
      if (Number.isFinite(v) && v >= min && v <= max) set(() => put(v), key);
    });
    return field(label, el, `${min} to ${max}`).el;
  };

  const group = (legend: string, ...children: (HTMLElement | null)[]) => h('fieldset', { class: 'panel__group' }, h('legend', {}, legend), ...children);

  // ---- colours ---------------------------------------------------------------

  const warnings = (mode: 'light' | 'dark', box: HTMLElement) => {
    clear(box);
    const palette = store.theme.tokens.colors[mode];
    const issues = palette ? contrastIssues(palette) : [];
    box.hidden = issues.length === 0;
    if (!issues.length) return;
    box.append(
      h('strong', {}, `Low contrast (${mode === 'light' ? 'main' : 'dark'} colours)`),
      h('ul', {}, ...issues.map((i) => h('li', {}, `${i.label}: ${i.ratio.toFixed(2)}:1, needs ${i.min}:1`))),
    );
  };

  const paletteEditor = (mode: 'light' | 'dark'): HTMLElement => {
    const box = h('div', { class: 'styles__warn', role: 'status' });
    const fields = PALETTE_ROLES.map(([role, label]) => {
      const current = () => store.theme.tokens.colors[mode]![role];
      const picker = h('input', { type: 'color', value: current(), 'aria-label': `${label} colour picker` });
      const text = h('input', { type: 'text', value: current(), maxlength: 7, spellcheck: 'false', autocapitalize: 'off', 'aria-label': `${label} hex value` });
      const apply = (v: string) => {
        set((t) => (t.colors[mode]![role] = v), `${mode}:${role}`);
        warnings(mode, box);
      };
      picker.addEventListener('input', () => {
        text.value = picker.value;
        text.removeAttribute('aria-invalid');
        apply(picker.value);
      });
      text.addEventListener('input', () => {
        const v = text.value.trim().toLowerCase();
        const valid = HEX.test(v);
        text.toggleAttribute('aria-invalid', !valid);
        if (!valid) return;
        picker.value = v;
        apply(v);
      });
      return h('div', { class: 'styles__color' }, h('span', { class: 'styles__swatch-label' }, label), picker, text);
    });
    warnings(mode, box);
    return h('div', {}, ...fields, box);
  };

  const colours = (): HTMLElement => {
    const darkOn = store.theme.tokens.colors.dark !== null;
    const dark = checkbox('Also define colours for dark mode', darkOn);
    dark.input.addEventListener('change', () =>
      store.editTheme((theme) => {
        const c = theme.tokens.colors;
        c.dark = dark.input.checked ? structuredClone(presetById(theme.preset)?.tokens.colors.dark ?? c.light) : null;
      }),
    );
    dark.input.addEventListener('change', render);
    return group(
      'Colours',
      h('p', { class: 'field__hint' }, 'Each section can pick one of four colour schemes (default, surface, inverse, accent) built from these colours.'),
      h('h3', { class: 'panel__h' }, 'Main colours'),
      paletteEditor('light'),
      dark.el,
      darkOn ? h('div', {}, h('h3', { class: 'panel__h' }, 'Dark mode colours'), paletteEditor('dark')) : null,
    );
  };

  // ---- other groups ----------------------------------------------------------

  const typography = (): HTMLElement => {
    const t = (): Typography => store.theme.tokens.typography;
    const fonts: [FontId, string][] = FONT_IDS.map((id) => [id, FONT_LABEL[id]]);
    return group(
      'Typography',
      choice('Heading font', fonts, () => t().headingFont, (v) => (t().headingFont = v), 'headingFont'),
      choice('Body font', fonts, () => t().bodyFont, (v) => (t().bodyFont = v), 'bodyFont'),
      choice<Typography['scale']>('Size scale', [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], () => t().scale, (v) => (t().scale = v), 'scale'),
      choice<Typography['headingWeight']>('Heading weight', [[300, 'Light'], [400, 'Regular'], [500, 'Medium'], [600, 'Semibold'], [700, 'Bold']], () => t().headingWeight, (v) => (t().headingWeight = v), 'headingWeight', 'Fonts without this weight use the nearest one.'),
      choice<Typography['bodyWeight']>('Body weight', [[300, 'Light'], [400, 'Regular'], [500, 'Medium']], () => t().bodyWeight, (v) => (t().bodyWeight = v), 'bodyWeight'),
      choice<Typography['headingCase']>('Heading case', [['none', 'As typed'], ['uppercase', 'UPPERCASE']], () => t().headingCase, (v) => (t().headingCase = v), 'headingCase'),
      number('Body line height', 1.2, 2, 0.05, () => t().lineHeight, (v) => (t().lineHeight = v), 'lineHeight'),
      number('Heading line height', 0.9, 1.6, 0.05, () => t().headingLineHeight, (v) => (t().headingLineHeight = v), 'headingLineHeight'),
      number('Body letter spacing (em)', -0.05, 0.2, 0.01, () => t().letterSpacing, (v) => (t().letterSpacing = v), 'letterSpacing'),
      number('Heading letter spacing (em)', -0.05, 0.2, 0.01, () => t().headingLetterSpacing, (v) => (t().headingLetterSpacing = v), 'headingLetterSpacing'),
    );
  };

  const shapes = (): HTMLElement => {
    const tokens = () => store.theme.tokens;
    return group(
      'Buttons, links and shape',
      choice<ThemeTokens['buttons']['shape']>('Button shape', [['square', 'Square'], ['rounded', 'Rounded'], ['pill', 'Pill']], () => tokens().buttons.shape, (v) => (tokens().buttons.shape = v), 'btnShape'),
      choice<ThemeTokens['buttons']['style']>('Button fill', [['solid', 'Filled'], ['outline', 'Outline']], () => tokens().buttons.style, (v) => (tokens().buttons.style = v), 'btnStyle'),
      choice<ThemeTokens['buttons']['textCase']>('Button text', [['none', 'As typed'], ['uppercase', 'UPPERCASE']], () => tokens().buttons.textCase, (v) => (tokens().buttons.textCase = v), 'btnCase'),
      choice<ThemeTokens['links']['underline']>('Link underline', [['always', 'Always'], ['hover', 'On hover'], ['none', 'Never']], () => tokens().links.underline, (v) => (tokens().links.underline = v), 'linkUnderline', 'Links without an underline rely on colour, so keep them in the accent colour.'),
      choice<ThemeTokens['links']['color']>('Link colour', [['text', 'Text colour'], ['accent', 'Accent colour']], () => tokens().links.color, (v) => (tokens().links.color = v), 'linkColor'),
      choice<ThemeTokens['spacing']['scale']>('Spacing', [['compact', 'Compact'], ['medium', 'Medium'], ['roomy', 'Roomy']], () => tokens().spacing.scale, (v) => (tokens().spacing.scale = v), 'spacing'),
      choice<ThemeTokens['radius']>('Corner radius', [['none', 'None'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], () => tokens().radius, (v) => (tokens().radius = v), 'radius'),
      (() => {
        const motion = checkbox('Animations (reveal and hover effects)', tokens().motion.enabled);
        motion.input.addEventListener('change', () => set((t) => (t.motion.enabled = motion.input.checked), 'motion'));
        return motion.el;
      })(),
    );
  };

  // ---- presets ---------------------------------------------------------------

  const presets = (): HTMLElement => {
    const list = h('div', { class: 'styles__presets', role: 'group', 'aria-label': 'Theme presets' });
    for (const p of THEME_PRESET_LIST) {
      const c = p.tokens.colors.light;
      const button = h(
        'button',
        { type: 'button', class: 'styles__preset', 'aria-pressed': String(store.theme.preset === p.id), 'data-preset': p.id },
        h('span', { class: 'styles__chips', 'aria-hidden': 'true' }, ...[c.background, c.surface, c.text, c.accent].map((col) => h('i', { style: `background:${col}` }))),
        h('strong', {}, p.label),
        h('span', { class: 'field__hint' }, p.description),
      );
      button.addEventListener('click', () => {
        store.editTheme((theme) => {
          theme.preset = p.id;
          theme.tokens = structuredClone(p.tokens);
        });
        render();
      });
      list.appendChild(button);
    }
    return list;
  };

  const header = (): HTMLElement => {
    const undo = h('button', { type: 'button', class: 'btn btn--ghost', disabled: !store.canUndoTheme, onclick: () => (store.undoTheme(), render()) }, 'Undo style change');
    const reset = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        'data-action': 'reset-theme',
        onclick: () => {
          const original = presetById(store.theme.preset) ?? presetById('classic')!;
          store.editTheme((theme) => (theme.tokens = structuredClone(original.tokens)));
          render();
        },
      },
      'Reset to preset',
    );
    const classic = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost',
        'data-action': 'reset-default',
        onclick: () => {
          const original = presetById('classic')!;
          store.editTheme((theme) => {
            theme.preset = original.id;
            theme.tokens = structuredClone(original.tokens);
          });
          render();
        },
      },
      'Reset to default',
    );
    return h('div', { class: 'panel__actions', role: 'group', 'aria-label': 'Style actions' }, undo, reset, classic);
  };

  function render(): void {
    clear(host);
    host.append(
      h('h2', { class: 'panel__title', tabindex: '-1' }, 'Site styles'),
      h('p', { class: 'field__hint' }, 'Changes show on the page right away and apply to the whole site. Publish to make them live.'),
      header(),
      group('Presets', presets()),
      colours(),
      typography(),
      shapes(),
    );
  }

  return { render };
}
