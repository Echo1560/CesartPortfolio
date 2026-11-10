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
import { moveButtons, pickMedia, thumb } from '../widgets';
import { BLOCK_INFO, SECTION_INFO, isFlexible } from './defaults';
import { resolvedFromRow } from './model';
import { pickBlock, pickSection } from './picker';
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

/** What the work choosers list. Set when the panel is created. */
let catalog: { works: { id: string; title: string; tags: string[]; categoryId: string }[]; categories: { id: string; label: string }[] } = { works: [], categories: [] };

/** A checklist of works. `ordered` keeps the chosen ones first, in order, with up/down buttons. */
function workList(ids: string[], onChange: (ids: string[]) => void, ordered = true): HTMLElement {
  const host = h('div', { class: 'worklist' });
  let chosen = [...ids];
  const paint = () => {
    clear(host);
    const list = h('ul', { class: 'worklist__list' });
    const title = (id: string) => catalog.works.find((w) => w.id === id)?.title ?? id;
    const row = (id: string, on: boolean, index: number) => {
      const c = checkbox(title(id), on);
      c.input.addEventListener('change', () => {
        chosen = c.input.checked ? [...chosen, id] : chosen.filter((x) => x !== id);
        onChange(chosen);
        paint();
      });
      const move = on && ordered ? moveButtons(index, chosen.length, title(id), (from, to) => {
        const [x] = chosen.splice(from, 1);
        chosen.splice(to, 0, x!);
        onChange(chosen);
        paint();
      }) : null;
      return h('li', { class: 'worklist__row' }, c.el, move);
    };
    chosen.forEach((id, i) => list.appendChild(row(id, true, i)));
    for (const w of catalog.works) if (!chosen.includes(w.id)) list.appendChild(row(w.id, false, 0));
    host.appendChild(list);
  };
  paint();
  return host;
}

/** A checklist of plain values (categories, tags). */
function valueList(options: [string, string][], ids: string[], onChange: (ids: string[]) => void): HTMLElement {
  const list = h('ul', { class: 'worklist__list' });
  let chosen = [...ids];
  for (const [value, label] of options) {
    const c = checkbox(label, chosen.includes(value));
    c.input.addEventListener('change', () => {
      chosen = c.input.checked ? [...chosen, value] : chosen.filter((x) => x !== value);
      onChange(chosen);
    });
    list.appendChild(h('li', { class: 'worklist__row' }, c.el));
  }
  return h('div', { class: 'worklist' }, list);
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
    } else if (key === 'workIds' && prop['type'] === 'array') {
      out.push(h('fieldset', { class: 'panel__group' }, h('legend', {}, 'Featured works (in this order)'), workList(Array.isArray(current) ? current : [], (v) => set(here, v))));
    } else if (key === 'columns' && prop['type'] === 'integer') {
      const options: [string, string][] = [];
      for (let n = prop['minimum'] ?? 2; n <= (prop['maximum'] ?? 4); n++) options.push([String(n), String(n)]);
      const el = select(options, String(current ?? prop['default'] ?? 2));
      el.addEventListener('change', () => set(here, Number(el.value)));
      out.push(field('Columns', el).el);
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
  const kindSelect = select(WORK_SOURCE_KINDS, kind);
  const picker = h('div', { class: 'field' });
  const items = (key: string): string[] => (Array.isArray(current?.[key]) ? (current![key] as string[]) : []);
  const emit = (k: string, key: string, v: string[]) => set(v.length ? { kind: k, [key]: v } : { kind: 'all' });
  const paint = (k: string) => {
    clear(picker);
    if (k === 'all') return;
    const hint = h('p', { class: 'field__hint' }, 'Pick at least one. Until then all works are shown.');
    if (k === 'category') picker.append(valueList(catalog.categories.map((c): [string, string] => [c.id, c.label]), items('categoryIds'), (v) => emit(k, 'categoryIds', v)), hint);
    if (k === 'tags') picker.append(valueList([...new Set(catalog.works.flatMap((w) => w.tags))].sort().map((t): [string, string] => [t, t]), items('tags'), (v) => emit(k, 'tags', v)), hint);
    if (k === 'manual') picker.append(workList(items('workIds'), (v) => emit(k, 'workIds', v), false), hint);
  };
  kindSelect.addEventListener('change', () => {
    paint(kindSelect.value);
    if (kindSelect.value === 'all') set({ kind: 'all' });
  });
  paint(kind);
  return [field('Works shown', kindSelect).el, picker];
}

/** Edits `content.buttons` of a hero or call-to-action section. */
function buttonsEditor(buttons: Json[], limit: { min: number; max: number }, set: (next: Json[]) => void): HTMLElement {
  const host = h('fieldset', { class: 'panel__group' });
  const list = buttons.map((b) => structuredClone(b));
  const paint = () => {
    clear(host);
    host.appendChild(h('legend', {}, 'Buttons'));
    list.forEach((b, i) => {
      const label = textInput(b['label'] ?? '', { maxlength: 60 });
      label.addEventListener('input', () => {
        b['label'] = label.value;
        if (label.value.trim()) set(list);
      });
      const style = select([['primary', 'Primary'], ['secondary', 'Secondary']], b['style'] ?? 'primary');
      style.addEventListener('change', () => {
        b['style'] = style.value;
        set(list);
      });
      host.append(field(`Button ${i + 1} label`, label).el, field(`Button ${i + 1} style`, style).el);
      if (b['link']?.kind === 'url') {
        const url = textInput(b['link'].url ?? '', {});
        url.addEventListener('input', () => {
          b['link'].url = url.value.trim();
          if (url.value.trim()) set(list);
        });
        host.appendChild(field(`Button ${i + 1} link`, url, 'https://…, mailto:, tel: or a site path like /about').el);
      }
      if (list.length > limit.min) host.appendChild(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { list.splice(i, 1); set(list); paint(); } }, `Remove button ${i + 1}`));
    });
    if (list.length < limit.max) host.appendChild(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { list.push({ label: 'Button', link: { kind: 'url', url: '/' }, style: 'primary' }); set(list); paint(); } }, 'Add a button'));
  };
  paint();
  return host;
}

export function createPanel(host: HTMLElement, store: EditorStore): Panel {
  catalog = { works: store.data.works.map((w) => ({ id: w.id, title: w.title, tags: w.tags, categoryId: w.categoryId })), categories: (store.data.snapshot.site.categories ?? []) as { id: string; label: string }[] };
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
      setMedia(resolvedFromRow(picked, { alt: current?.['alt'] && current['mediaId'] === picked.id ? current['alt'] : undefined, loop: current?.['loop'], posterId: current?.['posterId'], poster: current?.['poster'] }));
      render();
    };
    openers.set(slot, () => void choose());
    const replace = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void choose() }, current ? 'Replace…' : 'Choose image…');
    const group = h('fieldset', { class: 'panel__group', 'data-media-slot': slot }, h('legend', {}, label), current ? thumb(row, current['alt']) : null, h('div', { class: 'row' }, replace));
    if (current) {
      const alt = textInput(current['alt'] ?? '', { maxlength: 1000 });
      const altField = field('Alt text', alt, 'Describe the image for people who cannot see it.');
      alt.addEventListener('input', () => {
        const m = getMedia();
        const text = alt.value.trim();
        // Never save an empty alt: the draft could not be loaded again. The library's default text is the fallback.
        const value = text || row?.default_alt?.trim() || '';
        if (!value) {
          altField.setError('Alt text is required. The last text is kept.');
          return;
        }
        altField.setError(null);
        if (m) setMedia({ ...m, alt: value });
      });
      group.appendChild(altField.el);
      if (current['type'] === 'video') {
        const choosePoster = async () => {
          const picked = await pickMedia(draftLike, ['image'], () => undefined);
          const m = getMedia();
          if (!picked || !m) return;
          setMedia({ ...m, posterId: picked.id, poster: picked.storage_path });
          render();
        };
        group.appendChild(h('p', { class: 'field__hint' }, current['posterId'] ? 'Poster image set.' : 'A video needs a poster image before it can be saved.'));
        group.appendChild(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void choosePoster() }, current['posterId'] ? 'Change poster…' : 'Choose poster…'));
      }
      if (opts.removable) group.querySelector('.row')!.appendChild(h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { setMedia(undefined); render(); } }, 'Remove'));
    }
    return group;
  };

  const act = (key: string, label: string, text: string, onClick: () => void, disabled = false): HTMLButtonElement =>
    h('button', { type: 'button', class: 'btn btn--ghost', 'data-act': key, 'aria-label': label, title: label, disabled, onclick: onClick }, text);

  const sectionActions = (section: LooseSection): HTMLElement => {
    const sections = store.page?.sections ?? [];
    const i = sections.findIndex((x) => x.id === section.id);
    const name = `${human(section.type)} section`;
    return h(
      'div',
      { class: 'panel__actions', role: 'group', 'aria-label': 'Section actions' },
      act('up', `Move ${name} up`, '↑ Up', () => store.moveSection(section.id, i - 1), i <= 0),
      act('down', `Move ${name} down`, '↓ Down', () => store.moveSection(section.id, i + 1), i < 0 || i === sections.length - 1),
      act('duplicate', `Duplicate ${name}`, 'Duplicate', () => store.duplicateSection(section.id)),
      act('delete', `Delete ${name}`, 'Delete', () => store.deleteSection(section.id)),
    );
  };

  const columnCount = (section: LooseSection): number => (section.type === 'columns' ? ((section.settings as Json)['columns'] ?? 2) : 1);

  /** The blocks of a text or columns section, per column, with "add" buttons. */
  const blocksList = (section: LooseSection): HTMLElement => {
    const host = h('fieldset', { class: 'panel__group' }, h('legend', {}, 'Blocks'));
    const count = columnCount(section);
    for (let col = 0; col < count; col++) {
      const inColumn = (section.blocks ?? []).filter((b) => b.column === col);
      const list = h('ul', { class: 'blocklist' });
      for (const b of inColumn) list.appendChild(h('li', {}, h('button', { type: 'button', class: 'link', onclick: () => store.select({ sectionId: section.id, blockId: b.id }) }, BLOCK_INFO[b.type].label)));
      if (!inColumn.length) list.appendChild(h('li', { class: 'field__hint' }, 'No blocks yet.'));
      if (count > 1) host.appendChild(h('p', { class: 'panel__crumbs' }, `Column ${col + 1}`));
      host.append(list, act(`add-block-${col}`, count > 1 ? `Add a block to column ${col + 1}` : 'Add a block', 'Add a block', () => void pickBlock(store, section.id, col)));
    }
    return host;
  };

  const sectionPanel = (section: LooseSection): HTMLElement[] => {
    const id = section.id;
    const edit = (fn: (s: LooseSection) => void, key = '') => store.editSection(id, fn, 'panel', key);
    const out: HTMLElement[] = [sectionActions(section)];
    const variants = SECTION_VARIANTS[section.type as SectionType] as readonly string[];
    if (variants.length > 1) {
      const el = select(variants.map((v): [string, string] => [v, human(v)]), section.variant);
      el.addEventListener('change', () => edit((s) => (s.variant = el.value)));
      out.push(field('Layout variant', el).el);
    }
    if (isFlexible(section.type)) out.push(blocksList(section));
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

    if (section.type === 'hero' || section.type === 'cta') {
      const limit = section.type === 'cta' ? { min: 1, max: 2 } : { min: 0, max: 2 };
      out.push(
        buttonsEditor(Array.isArray(content['buttons']) ? (content['buttons'] as Json[]) : [], limit, (next) =>
          store.editSection(id, (s) => (next.length ? ((s.content as Json)['buttons'] = structuredClone(next)) : delete (s.content as Json)['buttons']), 'panel', `${id}:buttons`),
        ),
      );
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
    out.push(h('h3', { class: 'panel__h' }, 'Settings'), ...formFor(schema, section.settings as Json, (path, v) => {
      if (section.type === 'columns' && path.join('.') === 'columns') {
        // Blocks in a column that goes away move to the last column that stays.
        store.editSection(
          id,
          (s) => {
            const after = Number(v) || 2;
            setIn(s.settings as Json, path, v);
            if (s.blocks) {
              for (const b of s.blocks) if (b.column >= after) b.column = after - 1;
              s.blocks = [...s.blocks].sort((a, b) => a.column - b.column);
            }
          },
          'structure',
        );
      } else edit((s) => setIn(s.settings as Json, path, v), `${id}:set:${path.join('.')}`);
    }));
    return out;
  };

  const blockPanel = (section: LooseSection, block: LooseBlock): HTMLElement[] => {
    const sid = section.id;
    const bid = block.id;
    const edit = (fn: (b: LooseBlock) => void, key = '') => store.editBlock(sid, bid, fn, 'panel', key);
    const siblings = (section.blocks ?? []).filter((x) => x.column === block.column);
    const at = siblings.findIndex((x) => x.id === bid);
    const name = `${human(block.type)} block`;
    const count = columnCount(section);
    const out: HTMLElement[] = [
      h(
        'div',
        { class: 'panel__actions', role: 'group', 'aria-label': 'Block actions' },
        act('up', `Move ${name} up`, '↑ Up', () => store.moveBlock(sid, bid, block.column, at - 1), at <= 0),
        act('down', `Move ${name} down`, '↓ Down', () => store.moveBlock(sid, bid, block.column, at + 1), at < 0 || at === siblings.length - 1),
        act('duplicate', `Duplicate ${name}`, 'Duplicate', () => store.duplicateBlock(sid, bid)),
        act('delete', `Delete ${name}`, 'Delete', () => store.deleteBlock(sid, bid)),
      ),
    ];
    if (count > 1) {
      const col = select(Array.from({ length: count }, (_, i): [string, string] => [String(i), `Column ${i + 1}`]), String(block.column));
      col.addEventListener('change', () => store.moveBlock(sid, bid, Number(col.value), Number.MAX_SAFE_INTEGER));
      out.push(field('Column', col).el);
    }
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
    const focusedAct = host.contains(document.activeElement) ? (document.activeElement as HTMLElement).dataset['act'] : undefined;
    paint();
    if (focusedAct) host.querySelector<HTMLButtonElement>(`[data-act="${focusedAct}"]:not(:disabled)`)?.focus({ preventScroll: true });
  };

  const paint = (): void => {
    clear(host);
    openers.clear();
    const sel = store.selection;
    const section = sel ? store.findSection(sel.sectionId) : undefined;
    if (!sel || !section) {
      const page = store.page;
      host.append(
        h('h2', { class: 'panel__title' }, page?.title ?? 'No page'),
        h('p', { class: 'field__hint' }, 'Click a section on the page to change its settings. Click text to edit it in place; click an image to replace it.'),
        h('button', { type: 'button', class: 'btn', 'data-act': 'add-section', onclick: () => void pickSection(store, page?.sections.length ?? 0) }, 'Add a section'),
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
