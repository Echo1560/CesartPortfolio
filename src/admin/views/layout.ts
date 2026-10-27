/** Layout: home section order and visibility, featured works and grid options. */
import { layoutSchema } from '../../lib/schema';
import { checkbox, clear, field, h, select, textInput } from '../dom';
import { ok, stampText, type LayoutRow } from '../data';
import { sb } from '../supabase';
import { arrayMove, moveButtons } from '../widgets';
import type { ViewContext } from '../main';
import { card, runSave } from './shared';

const NAMES: Record<LayoutRow['section_id'], string> = { hero: 'Hero', featured: 'Featured work', grid: 'Work grid', about: 'About', contact: 'Contact' };

export function renderLayout(el: HTMLElement, ctx: ViewContext): void {
  const { draft } = ctx;
  const sections = draft.layout.map((l) => ({ id: l.section_id, visible: l.visible, options: structuredClone(l.options) as Record<string, any> }));
  const featuredIds = draft.featured.map((f) => f.work_id);
  const errors = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const listEl = h('ul', { class: 'list' });
  const detail = h('div', {});

  const renderDetail = () => {
    clear(detail);
    const feat = sections.find((s) => s.id === 'featured');
    const grid = sections.find((s) => s.id === 'grid');
    if (feat) {
      const limit = textInput(feat.options.limit ?? '', { type: 'number', min: 1, max: 999 });
      limit.oninput = () => (limit.value ? (feat.options.limit = Number(limit.value)) : delete feat.options.limit);
      const chosen = h('ul', { class: 'list' });
      const renderChosen = () => {
        clear(chosen);
        if (featuredIds.length === 0) chosen.appendChild(h('li', { class: 'empty' }, 'None chosen: the site falls back to works marked "Featured".'));
        featuredIds.forEach((id, i) => {
          const title = draft.works.find((w) => w.id === id)?.title ?? id;
          chosen.appendChild(h('li', { class: 'list__item' }, h('span', { class: 'grow' }, title), moveButtons(i, featuredIds.length, title, (a, b) => { arrayMove(featuredIds, a, b); renderChosen(); }), h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Remove ${title} from featured`, onclick: () => { featuredIds.splice(i, 1); renderChosen(); } }, 'Remove')));
        });
      };
      renderChosen();
      const options = draft.works.filter((w) => !featuredIds.includes(w.id)).map((w): [string, string] => [w.id, w.title]);
      const picker = select([['', 'Add a work…'], ...options], '');
      picker.setAttribute('aria-label', 'Add a featured work');
      picker.onchange = () => {
        if (picker.value) featuredIds.push(picker.value);
        renderDetail();
      };
      detail.append(h('h2', {}, 'Featured work'), field('Maximum shown (optional)', limit).el, chosen, field('Add featured work', picker).el);
    }
    if (grid) {
      const cols = (grid.options.columns ??= { sm: 1, md: 2, lg: 3 }) as Record<string, number>;
      const colInput = (key: 'sm' | 'md' | 'lg', label: string) => {
        const i = select(['1', '2', '3', '4', '5', '6'].map((n): [string, string] => [n, n]), String(cols[key]));
        i.onchange = () => (cols[key] = Number(i.value));
        return field(label, i).el;
      };
      const masonry = checkbox('Masonry layout', grid.options.masonry ?? true);
      masonry.input.onchange = () => (grid.options.masonry = masonry.input.checked);
      const filters = checkbox('Show category filters', grid.options.showFilters ?? true);
      filters.input.onchange = () => (grid.options.showFilters = filters.input.checked);
      detail.append(h('h2', {}, 'Work grid'), h('div', { class: 'row' }, colInput('sm', 'Columns on phones'), colInput('md', 'Columns on tablets'), colInput('lg', 'Columns on desktop')), masonry.el, filters.el);
    }
  };

  const renderList = () => {
    clear(listEl);
    sections.forEach((s, i) => {
      const vis = checkbox('Visible', s.visible);
      vis.input.setAttribute('aria-label', `${NAMES[s.id]} visible`);
      vis.input.onchange = () => (s.visible = vis.input.checked);
      vis.el.classList.add('check');
      listEl.appendChild(h('li', { class: 'list__item' }, h('strong', { class: 'grow' }, NAMES[s.id]), vis.el, moveButtons(i, sections.length, NAMES[s.id], (a, b) => { arrayMove(sections, a, b); renderList(); })));
    });
  };
  renderList();
  renderDetail();

  const save = h('button', { type: 'button', class: 'btn' }, 'Save layout');
  save.onclick = () => {
    const payload = sections.map((s) => {
      const options = { ...s.options };
      if (s.id === 'featured') {
        options.workIds = [...featuredIds];
      }
      return { id: s.id, visible: s.visible, options: s.id === 'hero' || s.id === 'about' || s.id === 'contact' ? undefined : options };
    });
    const parsed = layoutSchema.safeParse({ sections: payload });
    errors.hidden = parsed.success;
    errors.textContent = parsed.success ? '' : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    if (!parsed.success) return;
    void runSave(save, async () => {
      const rows = sections.map((s, position) => {
        const { workIds: _omit, ...options } = s.options;
        return { section_id: s.id, position, visible: s.visible, options: s.id === 'featured' ? (options.limit ? { limit: options.limit } : {}) : s.id === 'grid' ? options : {} };
      });
      // One request = one transaction, so the deferred unique positions can swap.
      ok(await sb().from('layout').upsert(rows, { onConflict: 'section_id' }).select('section_id'));
      // Upsert at offset positions first so a failure leaves the old list intact, then drop removed works and settle the positions.
      const offset = 1000;
      if (featuredIds.length) ok(await sb().from('layout_featured_works').upsert(featuredIds.map((work_id, position) => ({ work_id, position: offset + position })), { onConflict: 'work_id' }).select('work_id'));
      const gone = draft.featured.map((f) => f.work_id).filter((id) => !featuredIds.includes(id));
      if (gone.length) ok(await sb().from('layout_featured_works').delete().in('work_id', gone).select('work_id'));
      if (featuredIds.length) ok(await sb().from('layout_featured_works').upsert(featuredIds.map((work_id, position) => ({ work_id, position })), { onConflict: 'work_id' }).select('work_id'));
      await ctx.refresh();
    });
  };
  const newest = [...draft.layout, ...draft.featured].reduce((a, b) => (a.updated_at > b.updated_at ? a : b));
  el.append(h('h1', {}, 'Layout'), card('Home sections', stampText(newest, draft), h('p', { class: 'field__hint' }, 'Order and visibility of the sections on the home page.'), listEl), h('div', { class: 'card' }, detail), errors, save);
}
