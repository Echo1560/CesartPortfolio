/** Works: list with reorder, and the create/edit form. */
import { workSchema } from '../../lib/schema';
import { applyIssues, checkbox, clear, field, h, kebab, select, textArea, textInput, toast, type Field } from '../dom';
import { ok, placementToValue, saveGallery, saveSinglePlacement, stampText, valueToMedia, type WorkRow } from '../data';
import { sb } from '../supabase';
import { arrayMove, mediaField, moveButtons, type MediaField } from '../widgets';
import type { ViewContext } from '../main';
import { runSave } from './shared';

export function renderWorks(el: HTMLElement, ctx: ViewContext): void {
  const sub = location.hash.replace(/^#\/?/, '').split('/')[1];
  if (sub === 'new') return void el.appendChild(editor(ctx, null));
  if (sub) {
    const work = ctx.draft.works.find((w) => w.id === decodeURIComponent(sub));
    if (work) return void el.appendChild(editor(ctx, work));
  }
  el.appendChild(list(ctx));
}

function list(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const works = [...draft.works];
  const listEl = h('ul', { class: 'list' });
  const catLabel = (id: string) => draft.categories.find((c) => c.id === id)?.label ?? id;

  const render = () => {
    clear(listEl);
    if (works.length === 0) listEl.appendChild(h('li', { class: 'empty' }, 'No works yet.'));
    works.forEach((w, i) => {
      listEl.appendChild(
        h(
          'li',
          { class: 'list__item' },
          h('div', { class: 'grow' }, h('a', { href: `#/works/${encodeURIComponent(w.id)}` }, h('strong', {}, w.title)), h('p', { class: 'stamp' }, `${catLabel(w.category_id)}${w.year ? ` · ${w.year}` : ''} · ${stampText(w, draft)}`)),
          h('span', { class: `tag tag--${w.status}` }, w.status),
          w.featured ? h('span', { class: 'tag' }, 'featured') : null,
          moveButtons(i, works.length, w.title, async (a, b) => {
            arrayMove(works, a, b);
            render();
            try {
              // Spaced values so a later insert between two works needs no renumbering.
              await Promise.all(works.map((x, n) => sb().from('works').update({ sort_order: (n + 1) * 10 }).eq('id', x.id).select('id').then(ok)));
              toast('Order saved as draft');
            } catch (e) {
              toast((e as Error).message, 'error');
              await ctx.refresh();
            }
          }),
          h('a', { class: 'btn btn--ghost', href: `#/works/${encodeURIComponent(w.id)}` }, 'Edit'),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void remove(w) }, 'Delete'),
        ),
      );
    });
  };

  const remove = async (w: WorkRow) => {
    if (!confirm(`Delete "${w.title}"? Its cover, gallery and featured entry are removed from the draft. The media files stay in the library.`)) return;
    try {
      ok(await sb().from('works').delete().eq('id', w.id).select('id'));
      toast('Work deleted');
      await ctx.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  render();
  return h('div', {}, h('div', { class: 'card__head' }, h('h1', {}, 'Works'), h('a', { class: 'btn', href: '#/works/new' }, 'New work')), h('p', { class: 'field__hint' }, 'Order here is the order on the site. Status decides what the next publish includes.'), listEl);
}

function editor(ctx: ViewContext, work: WorkRow | null): HTMLElement {
  const { draft } = ctx;
  const title = textInput(work?.title ?? '');
  const slug = textInput(work?.slug ?? '', { readonly: work ? true : null });
  const year = textInput(work?.year ?? '', { type: 'number', min: 1900, max: 2100 });
  const category = select(
    draft.categories.map((c): [string, string] => [c.id, c.label]),
    work?.category_id ?? draft.categories[0]?.id ?? '',
  );
  const tags = textInput((work?.tags ?? []).join(', '));
  const desc = textArea(work?.description ?? '', 6, { maxlength: 10000 });
  const status = select(
    [
      ['draft', 'Draft (not in the next publish)'],
      ['published', 'Published (included in the next publish)'],
      ['archived', 'Archived (hidden everywhere)'],
    ],
    work?.status ?? 'draft',
  );
  const featured = checkbox('Featured', work?.featured ?? false);
  if (!work) title.addEventListener('input', () => { if (!slug.dataset.touched) slug.value = kebab(title.value); });
  slug.addEventListener('input', () => (slug.dataset.touched = '1'));

  const fields: Record<string, Field> = {
    title: field('Title', title),
    slug: field('Slug', slug, work ? 'The slug is part of the public URL and cannot change.' : 'Used in the public URL. Lowercase letters, digits and hyphens.'),
    year: field('Year', year),
    categoryId: field('Category', category),
    tags: field('Tags (comma separated)', tags),
    description: field('Description', desc),
  };

  const cover = mediaField(draft, 'Cover', placementToValue(draft.placements.find((p) => p.slot === 'work_cover' && p.work_id === work?.id)));
  const gallery: MediaField[] = draft.placements
    .filter((p) => p.slot === 'work_gallery' && p.work_id === work?.id)
    .sort((a, b) => a.position - b.position)
    .map((p, i) => mediaField(draft, `Gallery image ${i + 1}`, placementToValue(p)));
  const galleryEl = h('div', {});
  const renderGallery = () => {
    clear(galleryEl);
    gallery.forEach((g, i) =>
      galleryEl.append(
        g.el,
        h('div', { class: 'row' }, moveButtons(i, gallery.length, `gallery image ${i + 1}`, (a, b) => { arrayMove(gallery, a, b); renderGallery(); }), h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { gallery.splice(i, 1); renderGallery(); } }, `Remove gallery image ${i + 1}`)),
      ),
    );
  };
  renderGallery();
  const addGallery = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { gallery.push(mediaField(draft, `Gallery image ${gallery.length + 1}`, placementToValue(undefined))); renderGallery(); } }, 'Add gallery item');

  const save = h('button', { type: 'button', class: 'btn' }, work ? 'Save work' : 'Create work');
  save.onclick = () => {
    const tagList = tags.value.split(',').map((t) => t.trim()).filter(Boolean);
    const candidate = {
      id: work?.id ?? slug.value,
      slug: slug.value,
      title: title.value,
      year: year.value ? Number(year.value) : undefined,
      categoryId: category.value,
      tags: tagList,
      description: desc.value,
      media: valueToMedia(cover.get(), draft.media),
      gallery: gallery.map((g) => valueToMedia(g.get(), draft.media)),
    };
    const parsed = workSchema.safeParse(candidate);
    const issues = parsed.success ? [] : parsed.error.issues;
    applyIssues(fields, issues.filter((i) => i.path[0] !== 'media' && i.path[0] !== 'gallery' && i.path[0] !== 'id'));
    cover.showIssues(issues.filter((i) => i.path[0] === 'media').map((i) => ({ path: i.path.slice(1), message: i.message })));
    gallery.forEach((g, n) => g.showIssues(issues.filter((i) => i.path[0] === 'gallery' && i.path[1] === n).map((i) => ({ path: i.path.slice(2), message: i.message }))));
    if (!work && !draft.categories.length) fields.categoryId!.setError('Create a category first');
    if (!parsed.success || (!work && !draft.categories.length)) return;
    if (!work && draft.works.some((w) => w.slug === slug.value || w.id === slug.value)) return void fields.slug!.setError('A work with this slug already exists');

    void runSave(save, async () => {
      const row = { title: title.value.trim(), year: year.value ? Number(year.value) : null, category_id: category.value, tags: tagList, description: desc.value, featured: featured.input.checked, status: status.value };
      const id = work?.id ?? slug.value;
      if (work) ok(await sb().from('works').update(row).eq('id', id).select('id'));
      else ok(await sb().from('works').insert({ id, slug: id, sort_order: (draft.works.length + 1) * 10, ...row }).select('id'));
      await saveSinglePlacement('work_cover', id, draft.placements.find((p) => p.slot === 'work_cover' && p.work_id === id), cover.get());
      await saveGallery(id, gallery.map((g) => g.get()));
      location.hash = '#/works';
      await ctx.refresh();
    });
  };

  const stamp = work ? h('p', { class: 'stamp' }, stampText(work, draft)) : null;
  return h(
    'div',
    {},
    h('p', {}, h('a', { href: '#/works' }, '← All works')),
    h('h1', {}, work ? `Edit "${work.title}"` : 'New work'),
    stamp,
    h('div', { class: 'card' }, fields.title!.el, fields.slug!.el, h('div', { class: 'row' }, fields.year!.el, fields.categoryId!.el), fields.tags!.el, fields.description!.el, field('Status', status).el, featured.el),
    h('div', { class: 'card' }, h('h2', {}, 'Media'), cover.el, h('h3', {}, 'Gallery'), galleryEl, addGallery),
    save,
  );
}
