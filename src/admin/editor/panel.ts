/**
 * Side panel: the settings of the selected section or block. Forms are generated from
 * the contract's zod schemas (`schema-v3.ts`) through JSON Schema, so a new setting
 * shows up here without panel code. Content lives on the canvas; the panel only holds
 * what has no place there (variant, spacing, visibility, media and alt text).
 */
import { z } from 'zod';
import { blockSettingsSchema, draftSections, SECTION_VARIANTS, type SectionType } from '../../lib/schema-v3';
import type { LooseBlock, LooseSection } from '../../components/render/types';
import { checkbox, clear, field, h, select, textInput } from '../dom';
import type { Draft, MediaKind } from '../data';
import { pickMedia, thumb } from '../widgets';
import { resolvedFromRow } from './model';
import type { EditorStore } from './store';

type Json = Record<string, any>;

export interface Panel {
  render(): void;
  /** Scrolls to the media controls; with `open`, opens the library right away. */
  focusMedia(slot: string, open: boolean): void;
}

const MEDIA_KINDS: Record<string, MediaKind[]> = { default: ['image', 'animated'], video: ['video'] };

const human = (key: string): string =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

/** JSON Schema of a settings object. `io: 'input'` keeps defaults optional. */
function jsonSchema(schema: z.ZodType): Json {
  return z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Json;
}

const WORK_SOURCE_KINDS: [string, string][] = [
  ['all', 'All works'],
  ['category', 'By category'],
  ['tags', 'By tag'],
  ['manual', 'Chosen works'],
];

const csv = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** Builds the controls for the properties of one JSON-Schema object. `value` is mutated through `set`. */
function formFor(schema: Json, value: Json, set: (path: string[], v: unknown) => void, path: string[] = [], skip: Set<string> = new Set(['backgroundImage'])): HTMLElement[] {
  const out: HTMLElement[] = [];
  const required = new Set<string>(schema['required'] ?? []);
  for (const [key, prop] of Object.entries<Json>(schema['properties'] ?? {})) {
    if (skip.has(key)) continue;
    const here = [...path, key];
    const label = human(key);
    const current = value[key];
    const commit = (v: unknown) => set(here, v === '' ? undefined : v);
    if (key === 'source') {
      out.push(...workSourceControls(current, (v) => set(here, v)));
    } else if (prop['enum']) {
      const options: [string, string][] = [...(required.has(key) ? [] : ([['', 'Default']] as [string, string][])), ...(prop['enum'] as string[]).map((v): [string, string] => [v, human(v)])];
      const el = select(options, current ?? '');
      el.addEventListener('change', () => commit(el.value));
      out.push(field(label, el).el);
    } else if (prop['type'] === 'boolean') {
      const c = checkbox(label, Boolean(current));
      c.input.addEventListener('change', () => commit(c.input.checked));
      out.push(c.el);
    } else if (prop['type'] === 'integer' || prop['type'] === 'number') {
      const el = h('input', { type: 'number', value: current ?? '', min: prop['minimum'], max: prop['maximum'], step: prop['type'] === 'integer' ? 1 : 'any' });
      el.addEventListener('input', () => commit(el.value === '' ? undefined : Number(el.value)));
      out.push(field(label, el).el);
    } else if (prop['type'] === 'string') {
      const el = textInput(current ?? '', { maxlength: prop['maxLength'], ...(prop['format'] === 'email' ? { type: 'email' } : {}) });
      el.addEventListener('input', () => commit(el.value.trim()));
      out.push(field(label, el, key === 'anchor' ? 'Lowercase letters, digits and dashes. Lets a menu link jump here.' : undefined).el);
    } else if (prop['type'] === 'array' && prop['items']?.['type'] === 'string') {
      const el = textInput(Array.isArray(current) ? current.join(', ') : '');
      el.addEventListener('input', () => commit(csv(el.value)));
      out.push(field(label, el, 'Separate with commas.').el);
    } else if (prop['type'] === 'object' && prop['properties']) {
      const sub = (current && typeof current === 'object' ? current : {}) as Json;
      out.push(h('fieldset', { class: 'panel__group' }, h('legend', {}, label), ...formFor(prop, sub, set, here, skip)));
    }
  }
  return out;
}

function workSourceControls(current: Json | undefined, set: (v: unknown) => void): HTMLElement[] {
  const kind = current?.['kind'] ?? 'all';
  const list = (key: string) => (Array.isArray(current?.[key]) ? (current![key] as string[]).join(', ') : '');
  const kindSelect = select(WORK_SOURCE_KINDS, kind);
  const extra: Record<string, [string, string]> = { category: ['categoryIds', 'Category ids'], tags: ['tags', 'Tags'], manual: ['workIds', 'Work ids'] };
  const value = textInput(kind === 'all' ? '' : list(extra[kind]![0]), { 'aria-label': kind === 'all' ? 'Works' : extra[kind]![1] });
  const apply = () => {
    const k = kindSelect.value;
    if (k === 'all') set({ kind: 'all' });
    else {
      const items = csv(value.value);
      // The schema wants at least one item; until then keep showing all works.
      set(items.length ? { kind: k, [extra[k]![0]]: items } : { kind: 'all' });
    }
  };
  kindSelect.addEventListener('change', () => {
    value.hidden = kindSelect.value === 'all';
    apply();
  });
  value.addEventListener('input', apply);
  value.hidden = kind === 'all';
  return [field('Works shown', kindSelect).el, h('div', { class: 'field' }, value)];
}

export function createPanel(host: HTMLElement, store: EditorStore): Panel {
  const draftLike = { media: store.data.media } as Draft;
  let mediaRegion: HTMLElement | null = null;
  const openers = new Map<string, () => void>();

  const setIn = (root: Json, path: string[], v: unknown): void => {
    let node = root;
    for (const k of path.slice(0, -1)) {
      if (typeof node[k] !== 'object' || node[k] === null) node[k] = {};
      node = node[k];
    }
    const last = path[path.length - 1]!;
    if (v === undefined) delete node[last];
    else node[last] = v;
    // Drop objects left empty (`columns: {}` is not valid).
    if (v === undefined && path.length > 1) {
      let parent = root;
      for (let i = 0; i < path.length - 1; i++) {
        const child = parent[path[i]!];
        if (child && Object.keys(child).length === 0) delete parent[path[i]!];
        else parent = child;
        if (!parent) break;
      }
    }
  };

  const crumb = (label: string, onClick: (() => void) | null): HTMLElement =>
    onClick ? h('button', { type: 'button', class: 'link', onclick: onClick }, label) : h('span', { 'aria-current': 'location' }, label);

  const breadcrumb = (): HTMLElement => {
    const sel = store.selection!;
    const section = store.findSection(sel.sectionId)!;
    const items: HTMLElement[] = [crumb(store.page?.title ?? 'Page', () => store.select(null))];
    items.push(crumb(human(section.type), sel.blockId ? () => store.select({ sectionId: sel.sectionId }) : null));
    if (sel.blockId) items.push(crumb(`${human(store.findBlock(sel.sectionId, sel.blockId)?.type ?? 'block')} block`, null));
    return h('nav', { class: 'panel__crumbs', 'aria-label': 'Breadcrumb' }, ...items.flatMap((el, i) => (i ? [h('span', { 'aria-hidden': 'true' }, ' › '), el] : [el])));
  };

  const visibilityControls = (get: () => LooseSection | LooseBlock | undefined, edit: (fn: (x: LooseSection | LooseBlock) => void) => void): HTMLElement => {
    const v = get()?.visibility ?? { desktop: true, tablet: true, mobile: true };
    const group = h('fieldset', { class: 'panel__group' }, h('legend', {}, 'Show on'));
    for (const device of ['desktop', 'tablet', 'mobile'] as const) {
      const c = checkbox(human(device), v[device]);
      c.input.addEventListener('change', () => edit((x) => (x.visibility = { ...x.visibility, [device]: c.input.checked })));
      group.appendChild(c.el);
    }
    return group;
  };

  /** One media slot: thumbnail, replace, alt text, remove. */
  const mediaControl = (slot: string, label: string, getMedia: () => Json | undefined, setMedia: (m: Json | undefined) => void, opts: { kinds: MediaKind[]; removable: boolean }): HTMLElement => {
    const current = getMedia();
    const row = current ? store.data.media.find((m) => m.id === current['mediaId']) : undefined;
    const choose = async () => {
      const picked = await pickMedia(draftLike, opts.kinds, () => undefined);
      if (!picked) return;
      setMedia(resolvedFromRow(picked, { alt: current?.['alt'] && current['mediaId'] === picked.id ? current['alt'] : undefined, loop: current?.['loop'] }));
      render();
    };
    openers.set(slot, () => void choose());
    const replace = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void choose() }, current ? 'Replace…' : 'Choose image…');
    const group = h('fieldset', { class: 'panel__group', 'data-media-slot': slot }, h('legend', {}, label), current ? thumb(row, current['alt']) : null, h('div', { class: 'row' }, replace));
    if (current) {
      const alt = textInput(current['alt'] ?? '', { maxlength: 1000 });
      alt.addEventListener('input', () => {
        const m = getMedia();
        if (m) setMedia({ ...m, alt: alt.value });
      });
      group.appendChild(field('Alt text', alt, 'Describe the image for people who cannot see it.').el);
      if (opts.removable) group.querySelector('.row')!.appendChild(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { setMedia(undefined); render(); } }, 'Remove'));
    }
    return group;
  };

  const sectionPanel = (section: LooseSection): HTMLElement[] => {
    const id = section.id;
    const edit = (fn: (s: LooseSection) => void, key = '') => store.editSection(id, fn, 'panel', key);
    const out: HTMLElement[] = [];
    const variants = SECTION_VARIANTS[section.type as SectionType] as readonly string[];
    if (variants.length > 1) {
      const el = select(variants.map((v): [string, string] => [v, human(v)]), section.variant);
      el.addEventListener('change', () => edit((s) => (s.variant = el.value)));
      out.push(field('Layout variant', el).el);
    }
    out.push(visibilityControls(() => store.findSection(id), (fn) => edit(fn as (s: LooseSection) => void)));

    const content = section.content as Json;
    const media = (slot: string, label: string, removable: boolean) =>
      out.push(
        mediaControl(
          slot,
          label,
          () => (store.findSection(id)?.content as Json | undefined)?.[slot],
          (m) => store.editSection(id, (s) => (m ? ((s.content as Json)[slot] = m) : delete (s.content as Json)[slot]), 'media', `${id}:${slot}`),
          { kinds: MEDIA_KINDS['default']!, removable },
        ),
      );
    if (section.type === 'hero') media('media', 'Hero image', true);
    if (section.type === 'image') media('media', 'Image', false);
    if (section.type === 'about') media('portrait', 'Portrait', true);
    const bg = (section.settings as Json)['backgroundImage'] as Json | undefined;
    out.push(
      mediaControl(
        'backgroundImage',
        'Background image',
        () => ((store.findSection(id)?.settings as Json | undefined)?.['backgroundImage'] as Json | undefined)?.['image'],
        (m) =>
          store.editSection(
            id,
            (s) => {
              const st = s.settings as Json;
              if (m) st['backgroundImage'] = { overlay: st['backgroundImage']?.overlay ?? 0, image: m };
              else delete st['backgroundImage'];
            },
            'media',
            `${id}:bg`,
          ),
        { kinds: MEDIA_KINDS['default']!, removable: true },
      ),
    );
    if (bg) {
      const overlay = h('input', { type: 'number', min: 0, max: 90, value: bg['overlay'] ?? 0 });
      overlay.addEventListener('input', () => edit((s) => ((s.settings as Json)['backgroundImage'].overlay = Math.min(90, Math.max(0, Number(overlay.value) || 0))), `${id}:overlay`));
      out.push(field('Background overlay (%)', overlay).el);
    }

    // A heading that was emptied has no element to click: offer a text box.
    for (const key of ['heading', 'subheading', 'caption']) {
      if (!(key in content) && !(section.type === 'hero' && key === 'subheading') && !(['gallery', 'featured', 'works-list'].includes(section.type) && key === 'heading') && !(section.type === 'image' && key === 'caption')) continue;
      const v = content[key];
      if (Array.isArray(v) && v.length > 0) continue;
      const el = textInput('', { 'aria-label': human(key) });
      el.addEventListener('input', () => edit((s) => ((s.content as Json)[key] = el.value ? [{ type: 'text', text: el.value }] : []), `${id}:${key}:text`));
      out.push(field(`${human(key)} (empty — type to add)`, el).el);
    }

    const schema = jsonSchema(draftSections[section.type as SectionType].settings);
    out.push(h('h3', { class: 'panel__h' }, 'Settings'), ...formFor(schema, section.settings as Json, (path, v) => edit((s) => setIn(s.settings as Json, path, v), `${id}:set:${path.join('.')}`)));
    return out;
  };

  const blockPanel = (section: LooseSection, block: LooseBlock): HTMLElement[] => {
    const sid = section.id;
    const bid = block.id;
    const edit = (fn: (b: LooseBlock) => void, key = '') => store.editBlock(sid, bid, fn, 'panel', key);
    const out: HTMLElement[] = [];
    const content = block.content as Json;
    if (block.type === 'heading') {
      const el = select(['1', '2', '3', '4'].map((l): [string, string] => [l, `Heading ${l}`]), String(content['level']));
      el.addEventListener('change', () => edit((b) => ((b.content as Json)['level'] = Number(el.value))));
      out.push(field('Heading level', el).el);
    }
    if (block.type === 'image' || block.type === 'video') {
      out.push(
        mediaControl(
          'media',
          block.type === 'video' ? 'Video' : 'Image',
          () => (store.findBlock(sid, bid)?.content as Json | undefined)?.['media'],
          (m) => store.editBlock(sid, bid, (b) => ((b.content as Json)['media'] = m), 'media', `${bid}:media`),
          { kinds: MEDIA_KINDS[block.type === 'video' ? 'video' : 'default']!, removable: false },
        ),
      );
    }
    if (block.type === 'button') {
      const label = textInput(content['label'] ?? '', { maxlength: 60 });
      label.addEventListener('input', () => edit((b) => ((b.content as Json)['label'] = label.value), `${bid}:label`));
      out.push(field('Button label', label).el);
      const style = select([['primary', 'Primary'], ['secondary', 'Secondary']], content['style'] ?? 'primary');
      style.addEventListener('change', () => edit((b) => ((b.content as Json)['style'] = style.value)));
      out.push(field('Style', style).el);
      if (content['link']?.kind === 'url') {
        const url = textInput(content['link'].url ?? '', { type: 'url' });
        url.addEventListener('input', () => edit((b) => (((b.content as Json)['link'] as Json)['url'] = url.value.trim()), `${bid}:url`));
        out.push(field('Link address', url, 'https://…, mailto: or tel:').el);
      }
    }
    if (block.type === 'spacer') {
      const size = select(['none', 'xs', 'sm', 'md', 'lg', 'xl'].map((v): [string, string] => [v, human(v)]), content['size'] ?? 'md');
      size.addEventListener('change', () => edit((b) => ((b.content as Json)['size'] = size.value)));
      out.push(field('Size', size).el);
    }
    out.push(visibilityControls(() => store.findBlock(sid, bid), (fn) => edit(fn as (b: LooseBlock) => void)));
    out.push(h('h3', { class: 'panel__h' }, 'Settings'), ...formFor(jsonSchema(blockSettingsSchema), block.settings as Json, (path, v) => edit((b) => setIn(b.settings as Json, path, v), `${bid}:set:${path.join('.')}`)));
    return out;
  };

  const render = (): void => {
    clear(host);
    openers.clear();
    const sel = store.selection;
    const section = sel ? store.findSection(sel.sectionId) : undefined;
    if (!sel || !section) {
      const page = store.page;
      host.append(
        h('h2', { class: 'panel__title' }, page?.title ?? 'No page'),
        h('p', { class: 'field__hint' }, 'Click a section on the page to change its settings. Click text to edit it in place; click an image to replace it.'),
        ...(page ? [h('p', { class: 'stamp' }, `/${page.isHome ? '' : page.slug}${page.status !== 'published' ? ` · ${page.status}` : ''}`)] : []),
      );
      return;
    }
    const block = sel.blockId ? store.findBlock(section.id, sel.blockId) : undefined;
    host.append(breadcrumb(), h('h2', { class: 'panel__title' }, block ? `${human(block.type)} block` : `${human(section.type)} section`));
    mediaRegion = h('div', { class: 'panel__body' }, ...(block ? blockPanel(section, block) : sectionPanel(section)));
    host.appendChild(mediaRegion);
  };

  return {
    render,
    focusMedia(slot, open) {
      const group = mediaRegion?.querySelector<HTMLElement>(`[data-media-slot="${slot}"]`);
      group?.scrollIntoView({ block: 'nearest' });
      if (open) openers.get(slot)?.();
      else group?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    },
  };
}
