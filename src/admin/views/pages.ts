/**
 * Pages and navigation: create (blank or from a template), rename, duplicate, delete, reorder and
 * hide pages, edit each page's slug and SEO, and edit the menu and footer (docs/V3-CONTRACTS.md §2, §3.5).
 * Page rows, `site.nav` and `site.footer` are written directly through RLS and validated first.
 */
import { pageDraftSchema, RESERVED_SLUGS, siteFooterSchema, siteNavSchema, type InlineText, type Link, type NavItem, type SiteFooter, type SiteNav } from '../../lib/schema-v3';
import { checkbox, clear, field, h, kebab, select, textArea, textInput, toast } from '../dom';
import { ok, type Draft, type MediaRow } from '../data';
import { sb } from '../supabase';
import { arrayMove, moveButtons, pickMedia } from '../widgets';
import { newId } from '../editor/defaults';
import { PAGE_TEMPLATES } from '../editor/page-templates';
import { blockPayload, checkBlock, checkSection, sectionPayload } from '../editor/model';
import type { ViewContext } from '../main';
import { card, runSave } from './shared';

type Status = 'draft' | 'published' | 'hidden';
interface PageRow {
  id: string;
  slug: string;
  title: string;
  seo_title: string | null;
  seo_description: string | null;
  social_media_id: string | null;
  status: Status;
  is_home: boolean;
  position: number;
  sections: { count: number }[];
}
export interface State {
  pages: PageRow[];
  media: MediaRow[];
  nav: SiteNav;
  footer: SiteFooter;
  email: string;
}

const STATUS_LABEL: Record<Status, string> = { published: 'Published', draft: 'Draft', hidden: 'Hidden' };
const STATUS_HINT = 'Published pages go live with the next publish. Draft pages are never built. Hidden pages are taken offline but kept here.';
const PAGE_COLUMNS = 'id, slug, title, seo_title, seo_description, social_media_id, status, is_home, position, sections(count)';
const itemId = (): string => `item-${newId().slice(0, 8)}`;

/** A free slug for a title: kebab-case, not reserved, not taken. */
export function suggestSlug(title: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = kebab(title).slice(0, 90).replace(/-+$/, '') || 'page';
  if ((RESERVED_SLUGS as readonly string[]).includes(base) || base.startsWith('_')) base = `${base}-page`;
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  return slug;
}

export async function renderPages(el: HTMLElement, _ctx: ViewContext): Promise<void> {
  const state = await load();
  const host = h('div', {});
  el.append(h('h1', {}, 'Pages and navigation'), host);
  const paint = () => {
    clear(host);
    host.append(pagesCard(state, reload), navCard(state, reload), footerCard(state, reload));
  };
  async function reload(): Promise<void> {
    Object.assign(state, await load());
    paint();
  }
  paint();
}

async function load(): Promise<State> {
  const c = sb();
  const [pages, site, media] = await Promise.all([
    c.from('pages').select(PAGE_COLUMNS).order('position'),
    c.from('site').select('nav, footer, contact_email').eq('id', 1).single(),
    c.from('media').select('*').order('created_at', { ascending: false }),
  ]);
  const s = ok(site) as { nav: SiteNav; footer: SiteFooter; contact_email: string };
  return { pages: (ok(pages) ?? []) as PageRow[], media: (ok(media) ?? []) as MediaRow[], nav: s.nav ?? { items: [] }, footer: s.footer, email: s.contact_email };
}

// ---- dialogs ----------------------------------------------------------------

/** A modal confirmation. Resolves true only when the editor confirms. */
function confirmDialog(title: string, message: string, confirm: string, opener: Element | null): Promise<boolean> {
  return new Promise((resolve) => {
    let yes = false;
    const dialog = h('dialog', { class: 'picker', 'aria-labelledby': 'confirm-title' });
    dialog.append(
      h('h2', { id: 'confirm-title', class: 'panel__title' }, title),
      h('p', {}, message),
      h('div', { class: 'row' }, h('button', { type: 'button', class: 'btn', 'data-confirm': 'yes', onclick: () => { yes = true; dialog.close(); } }, confirm), h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel')),
    );
    dialog.addEventListener('close', () => {
      dialog.remove();
      (opener as HTMLElement | null)?.focus?.();
      resolve(yes);
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.btn--ghost')?.focus();
  });
}

/** A modal form. `build` returns the body and a `submit` that resolves true to close it. */
function formDialog(title: string, opener: Element | null, build: (close: () => void) => { body: Node[]; submit: () => Promise<boolean>; label: string }): void {
  const dialog = h('dialog', { class: 'picker', 'aria-labelledby': 'form-title' });
  const { body, submit, label } = build(() => dialog.close());
  const saveBtn = h('button', { type: 'submit', class: 'btn' }, label);
  const form = h('form', { novalidate: true }, h('h2', { id: 'form-title', class: 'panel__title' }, title), ...body, h('div', { class: 'row' }, saveBtn, h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => dialog.close() }, 'Cancel')));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void runSave(saveBtn, async () => {
      if (await submit()) dialog.close();
    }, `${label} done`).then(() => undefined);
  });
  dialog.appendChild(form);
  dialog.addEventListener('close', () => {
    dialog.remove();
    (opener as HTMLElement | null)?.focus?.();
  });
  document.body.appendChild(dialog);
  dialog.showModal();
  dialog.querySelector<HTMLElement>('input, select, textarea')?.focus();
}

// ---- pages ------------------------------------------------------------------

const navIndex = (nav: SiteNav, pageId: string): number => nav.items.findIndex((i) => i.link.kind === 'page' && i.link.pageId === pageId && !i.link.anchor);
const pageLink = (id: string): Link => ({ kind: 'page', pageId: id });

async function saveNav(nav: SiteNav): Promise<void> {
  const parsed = siteNavSchema.safeParse(nav);
  if (!parsed.success) throw new Error(`Navigation: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const rows = ok(await sb().from('site').update({ nav: parsed.data }).eq('id', 1).select('id'));
  if (!rows?.length) throw new Error('Not saved: you can no longer edit the navigation');
}

/** Appends a menu item. Shared state only changes once the save succeeded. */
export async function addNavItem(state: State, item: NavItem): Promise<void> {
  const nav = { ...state.nav, items: [...state.nav.items, item] };
  await saveNav(nav);
  state.nav = nav;
}

/** Removes every menu and footer link that points to a page. */
function dropPageLinks(state: State, pageId: string): { nav: SiteNav; footer: SiteFooter } {
  const goes = (l: { link: Link }) => l.link.kind === 'page' && l.link.pageId === pageId;
  const nav: SiteNav = { ...state.nav, items: state.nav.items.filter((i) => !goes(i)).map((i) => (i.children ? { ...i, children: i.children.filter((c) => !goes(c)) } : i)) };
  if (nav.cta && goes(nav.cta)) delete nav.cta;
  return { nav, footer: { ...state.footer, links: state.footer.links.filter((l) => !goes(l)) } };
}

/** Deletes a page, then strips its menu and footer links (the renderer skips links to missing pages, so a failed cleanup is harmless). */
export async function deletePage(state: State, pageId: string): Promise<void> {
  ok(await sb().from('pages').delete().eq('id', pageId).select('id'));
  const { nav, footer } = dropPageLinks(state, pageId);
  await saveNav(nav);
  state.nav = nav;
  await saveFooter(footer);
  state.footer = footer;
}

async function saveFooter(footer: SiteFooter): Promise<void> {
  const parsed = siteFooterSchema.safeParse(footer);
  if (!parsed.success) throw new Error(`Footer: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const rows = ok(await sb().from('site').update({ footer: parsed.data }).eq('id', 1).select('id'));
  if (!rows?.length) throw new Error('Not saved: you can no longer edit the footer');
}

function pagesCard(state: State, reload: () => Promise<void>): HTMLElement {
  const list = h('ul', { class: 'list', 'aria-label': 'Pages' });
  const taken = () => state.pages.map((p) => p.slug);
  const run = async (button: HTMLButtonElement, action: () => Promise<void>, message: string) => {
    if (await runSave(button, action, message)) await reload();
  };

  const reorder = async (from: number, to: number) => {
    const next = [...state.pages];
    arrayMove(next, from, to);
    // Positions are unique but deferred, so one upsert can swap them.
    const rows = next.map((p, i) => ({ id: p.id, slug: p.slug, title: p.title, position: i }));
    try {
      ok(await sb().from('pages').upsert(rows, { onConflict: 'id' }).select('id'));
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  state.pages.forEach((p, i) => {
    const inNav = navIndex(state.nav, p.id) >= 0;
    const count = p.sections[0]?.count ?? 0;
    const duplicate = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Duplicate ${p.title}` }, 'Duplicate');
    duplicate.onclick = () => void run(duplicate, () => duplicatePage(p, taken()), 'Page duplicated');
    const remove = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Delete ${p.title}`, disabled: p.is_home, title: p.is_home ? 'The home page cannot be deleted. Make another page the home page first.' : undefined }, 'Delete');
    remove.onclick = async () => {
      const yes = await confirmDialog(`Delete "${p.title}"?`, `This deletes the page and its ${count} section${count === 1 ? '' : 's'}. Links to it in the menu and footer are removed. Anything you published earlier stays in the version history. This cannot be undone.`, 'Delete page', remove);
      if (!yes) return;
      await run(remove, async () => {
        await deletePage(state, p.id);
      }, 'Page deleted');
    };
    const home = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Make ${p.title} the home page` }, 'Make home');
    home.onclick = async () => {
      const yes = await confirmDialog(`Make "${p.title}" the home page?`, 'It will be served at the root of the site, and it is published. The current home page becomes a normal page at its own address.', 'Make home page', home);
      if (yes) await run(home, async () => void ok(await sb().rpc('set_home_page', { p_page_id: p.id })), 'Home page changed');
    };
    const settings = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Settings of ${p.title}` }, 'Settings');
    settings.onclick = () => settingsDialog(state, p, settings, reload);
    list.appendChild(
      h(
        'li',
        { class: 'list__item', 'data-page': p.slug },
        h(
          'span',
          { class: 'grow' },
          h('strong', {}, p.title),
          p.is_home ? ' · home' : '',
          h('br'),
          h('span', { class: 'stamp' }, `/${p.is_home ? '' : `${p.slug}/`} · ${STATUS_LABEL[p.status]} · ${count} section${count === 1 ? '' : 's'}${inNav ? ' · in menu' : ''}`),
        ),
        h('a', { class: 'btn btn--ghost', href: `#/editor/${p.slug}`, 'aria-label': `Edit ${p.title}` }, 'Edit'),
        settings,
        duplicate,
        p.is_home ? null : home,
        remove,
        moveButtons(i, state.pages.length, p.title, (a, b) => void reorder(a, b)),
      ),
    );
  });

  const add = h('button', { type: 'button', class: 'btn' }, 'New page');
  add.onclick = () => newPageDialog(state, add, reload);
  return card('Pages', null, h('p', { class: 'field__hint' }, STATUS_HINT), list, add);
}

export async function duplicatePage(p: PageRow, taken: string[]): Promise<void> {
  const c = sb();
  const [secs, last] = await Promise.all([c.from('sections').select('*, blocks(*)').eq('page_id', p.id).order('position'), c.from('pages').select('position').order('position', { ascending: false }).limit(1)]);
  const position = ((ok(last) as { position: number }[])[0]?.position ?? -1) + 1;
  const id = newId();
  ok(await c.from('pages').insert({ id, slug: suggestSlug(`${p.slug}-copy`, taken), title: `${p.title} (copy)`.slice(0, 120), seo_title: p.seo_title, seo_description: p.seo_description, social_media_id: p.social_media_id, status: 'draft', position }).select('id'));
  const sections = (ok(secs) ?? []) as Record<string, any>[];
  const rows: Record<string, unknown>[] = [];
  const blocks: Record<string, unknown>[] = [];
  for (const s of sections) {
    const sid = newId();
    rows.push({ id: sid, page_id: id, type: s.type, variant: s.variant, position: s.position, settings: s.settings, content: s.content, show_on_desktop: s.show_on_desktop, show_on_tablet: s.show_on_tablet, show_on_mobile: s.show_on_mobile });
    for (const b of s.blocks ?? []) blocks.push({ id: newId(), section_id: sid, type: b.type, column_index: b.column_index, position: b.position, settings: b.settings, content: b.content, show_on_desktop: b.show_on_desktop, show_on_tablet: b.show_on_tablet, show_on_mobile: b.show_on_mobile });
  }
  try {
    if (rows.length) ok(await c.from('sections').insert(rows).select('id'));
    if (blocks.length) ok(await c.from('blocks').insert(blocks).select('id'));
  } catch (e) {
    // Do not leave a half-copied draft behind.
    await c.from('pages').delete().eq('id', id);
    throw e;
  }
}

function newPageDialog(state: State, opener: Element, reload: () => Promise<void>): void {
  formDialog('New page', opener, (close) => {
    const title = textInput('', { maxlength: 120 });
    const slug = textInput('', { maxlength: 100 });
    const template = select(PAGE_TEMPLATES.map((t): [string, string] => [t.id, t.label]), 'blank');
    const status = select([['published', 'Published'], ['draft', 'Draft']], 'published');
    const hint = h('p', { class: 'field__hint' }, PAGE_TEMPLATES[0]!.description);
    const inNav = checkbox('Add to the navigation menu', true);
    let slugTouched = false;
    const titleField = field('Page title', title);
    const slugField = field('Address (slug)', slug, 'Lowercase letters, numbers and dashes. The page lives at /CesartPortfolio/<slug>/.');
    const taken = state.pages.map((p) => p.slug);
    title.addEventListener('input', () => {
      if (!slugTouched) slug.value = title.value.trim() ? suggestSlug(title.value, taken) : '';
    });
    slug.addEventListener('input', () => (slugTouched = true));
    template.addEventListener('change', () => {
      const t = PAGE_TEMPLATES.find((x) => x.id === template.value)!;
      hint.textContent = t.description;
      if (!title.value.trim() || title.dataset['auto'] === '1') {
        title.value = t.id === 'blank' ? '' : t.title;
        title.dataset['auto'] = '1';
        if (!slugTouched) slug.value = title.value ? suggestSlug(title.value, taken) : '';
      }
    });
    title.addEventListener('input', () => delete title.dataset['auto']);
    return {
      label: 'Create page',
      body: [field('Start from', template).el, hint, titleField.el, slugField.el, field('Status', status).el, inNav.el],
      async submit() {
        titleField.setError(null);
        slugField.setError(null);
        const value = { slug: slug.value.trim(), title: title.value, status: status.value as Status };
        const parsed = pageDraftSchema.safeParse(value);
        if (!parsed.success) {
          for (const i of parsed.error.issues) (i.path[0] === 'title' ? titleField : slugField).setError(i.message);
          return false;
        }
        if (taken.includes(parsed.data.slug)) {
          slugField.setError('Another page already uses this address.');
          return false;
        }
        const t = PAGE_TEMPLATES.find((x) => x.id === template.value)!;
        const sections = t.build({ works: [], email: state.email });
        const last = state.pages.reduce((m, p) => Math.max(m, p.position), -1);
        const id = newId();
        const c = sb();
        ok(await c.from('pages').insert({ id, slug: parsed.data.slug, title: parsed.data.title, status: parsed.data.status, position: last + 1 }).select('id'));
        try {
          if (sections.length) {
            ok(await c.from('sections').insert(sections.map((s, i) => { checkSection(s); return { id: s.id, page_id: id, type: s.type, position: i, ...sectionPayload(s) }; })).select('id'));
            const blocks = sections.flatMap((s) => (s.blocks ?? []).map((b, j) => { checkBlock(b); return { id: b.id, section_id: s.id, type: b.type, column_index: b.column, position: j, ...blockPayload(b) }; }));
            if (blocks.length) ok(await c.from('blocks').insert(blocks).select('id'));
          }
          if (inNav.input.checked) {
            await addNavItem(state, { id: itemId(), label: parsed.data.title.slice(0, 60), link: pageLink(id) });
          }
        } catch (e) {
          // Do not leave a half-built page behind.
          await c.from('pages').delete().eq('id', id);
          throw e;
        }
        close();
        await reload();
        location.hash = `#/editor/${parsed.data.slug}`;
        return true;
      },
    };
  });
}

function settingsDialog(state: State, p: PageRow, opener: Element, reload: () => Promise<void>): void {
  formDialog(`Settings: ${p.title}`, opener, (close) => {
    const title = textInput(p.title, { maxlength: 120 });
    const slug = textInput(p.slug, { maxlength: 100 });
    const status = select(p.is_home ? [['published', 'Published (the home page cannot be hidden)']] : (['published', 'draft', 'hidden'] as Status[]).map((s): [string, string] => [s, STATUS_LABEL[s]]), p.status);
    status.disabled = p.is_home;
    const seoTitle = textInput(p.seo_title ?? '', { maxlength: 200 });
    const seoDesc = textArea(p.seo_description ?? '', 3, { maxlength: 500 });
    const inNav = checkbox('Show in the navigation menu', navIndex(state.nav, p.id) >= 0);
    let social = p.social_media_id;
    const socialName = h('span', { class: 'stamp' });
    const paintSocial = () => (socialName.textContent = social ? (state.media.find((m) => m.id === social)?.original_name ?? 'Image chosen') : 'Not set: the site default is used.');
    paintSocial();
    const choose = h('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => {
      const row = await pickMedia({ media: state.media } as Draft, ['image'], (r) => state.media.unshift(r));
      if (row) { social = row.id; paintSocial(); }
    } }, 'Choose image');
    const clearSocial = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { social = null; paintSocial(); } }, 'Remove');
    const titleField = field('Page name', title, 'Also the default menu label.');
    const slugField = field('Address (slug)', slug, p.is_home ? 'The home page is always served at the root of the site.' : 'Lowercase letters, numbers and dashes.');
    const statusField = field('Status', status, STATUS_HINT);
    const suggest = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => (slug.value = suggestSlug(title.value, state.pages.filter((x) => x.id !== p.id).map((x) => x.slug))) }, 'Suggest from the page name');
    return {
      label: 'Save settings',
      body: [titleField.el, slugField.el, suggest, statusField.el, inNav.el, h('h3', {}, 'Search and sharing'), field('SEO title', seoTitle, 'Shown in search results and the browser tab. Empty uses the site default.').el, field('SEO description', seoDesc).el, h('div', {}, h('p', { class: 'field__label' }, 'Social image'), socialName, h('div', { class: 'row' }, choose, clearSocial))],
      async submit() {
        for (const f of [titleField, slugField, statusField]) f.setError(null);
        const value = { slug: slug.value.trim(), title: title.value, status: status.value as Status, seo_title: seoTitle.value.trim() || null, seo_description: seoDesc.value.trim() || null, social_media_id: social };
        const parsed = pageDraftSchema.safeParse(value);
        if (!parsed.success) {
          for (const i of parsed.error.issues) ({ title: titleField, status: statusField }[String(i.path[0])] ?? slugField).setError(i.message);
          return false;
        }
        const clash = state.pages.some((x) => x.id !== p.id && x.slug === parsed.data.slug);
        if (clash) {
          slugField.setError('Another page already uses this address.');
          return false;
        }
        if (parsed.data.slug !== p.slug && p.status === 'published' && !p.is_home) {
          const yes = await confirmDialog('Change the address?', `Links to /${p.slug}/ (from other sites, search results or bookmarks) will stop working once this is published. Menu links and links inside the site keep working. Continue?`, 'Change address', null);
          if (!yes) return false;
        }
        const rows = ok(await sb().from('pages').update(parsed.data).eq('id', p.id).select('id'));
        if (!rows?.length) throw new Error('Not saved: you can no longer edit this page');
        const at = navIndex(state.nav, p.id);
        if (inNav.input.checked && at < 0) {
          state.nav.items.push({ id: itemId(), label: parsed.data.title.slice(0, 60), link: pageLink(p.id) });
          await saveNav(state.nav);
        } else if (!inNav.input.checked && at >= 0) {
          state.nav.items.splice(at, 1);
          await saveNav(state.nav);
        }
        close();
        await reload();
        return true;
      },
    };
  });
}

// ---- navigation and footer --------------------------------------------------

interface LinkEditor {
  el: HTMLElement;
  get(): Link;
}

/** Edits one link: a page (with an optional anchor), an external address or an anchor on the home page. */
function linkEditor(state: State, link: Link, label: string): LinkEditor {
  const kind = select(
    [
      ['page', 'A page of this site'],
      ['url', 'An external address'],
      ['anchor', 'A section anchor'],
      ...(link.kind === 'work' ? ([['work', 'A work (kept as is)']] as [string, string][]) : []),
    ],
    link.kind,
  );
  kind.setAttribute('aria-label', `${label}: link type`);
  const page = select(state.pages.map((p): [string, string] => [p.id, p.title]), link.kind === 'page' ? link.pageId : (state.pages.find((p) => p.is_home)?.id ?? state.pages[0]?.id ?? ''));
  page.setAttribute('aria-label', `${label}: page`);
  const anchor = textInput(link.kind === 'page' || link.kind === 'anchor' ? (link.anchor ?? '') : '', { 'aria-label': `${label}: anchor`, placeholder: 'anchor, e.g. contact' });
  const url = textInput(link.kind === 'url' ? link.url : '', { 'aria-label': `${label}: address`, placeholder: 'https://…' });
  const newTab = checkbox('Open in a new tab', link.kind === 'url' ? Boolean(link.newTab) : false);
  const el = h('span', { class: 'row' });
  const show = () => {
    for (const x of [page, anchor, url, newTab.el]) x.hidden = true;
    if (kind.value === 'page') { page.hidden = false; anchor.hidden = false; }
    if (kind.value === 'anchor') anchor.hidden = false;
    if (kind.value === 'url') { url.hidden = false; newTab.el.hidden = false; }
  };
  kind.addEventListener('change', show);
  show();
  el.append(kind, page, anchor, url, newTab.el);
  return {
    el,
    get() {
      const a = anchor.value.trim().replace(/^#/, '');
      if (kind.value === 'page') return { kind: 'page', pageId: page.value, ...(a ? { anchor: a } : {}) };
      if (kind.value === 'anchor') return { kind: 'anchor', anchor: a };
      if (kind.value === 'work' && link.kind === 'work') return link;
      let u = url.value.trim();
      if (u && !/^([a-z]+:|\/|#)/i.test(u)) u = `https://${u}`;
      return { kind: 'url', url: u, ...(newTab.input.checked ? { newTab: true } : {}) };
    },
  };
}

interface Row {
  id: string;
  label: HTMLInputElement;
  link: LinkEditor;
  children?: Row[];
}

function labelOf(state: State, link: Link): string {
  return link.kind === 'page' ? (state.pages.find((p) => p.id === link.pageId)?.title ?? '') : '';
}

function navCard(state: State, reload: () => Promise<void>): HTMLElement {
  const toRow = (i: { id: string; label: string; link: Link; children?: unknown[] }, n: string): Row => ({ id: i.id, label: textInput(i.label, { maxlength: 60, 'aria-label': `${n} label` }), link: linkEditor(state, i.link, n) });
  const rows: Row[] = state.nav.items.map((i, k) => ({ ...toRow(i, `Item ${k + 1}`), children: (i.children ?? []).map((c, j) => toRow(c, `Item ${k + 1}, dropdown ${j + 1}`)) }));
  const list = h('ul', { class: 'list', 'aria-label': 'Menu items' });

  const itemEl = (r: Row, siblings: Row[], index: number, depth: 0 | 1, rerender: () => void): HTMLElement => {
    const name = r.label.value || 'item';
    const kids = depth === 0 ? h('ul', { class: 'list', 'aria-label': `Dropdown of ${name}` }) : null;
    if (kids && r.children) r.children.forEach((c, j) => kids.appendChild(itemEl(c, r.children!, j, 1, rerender)));
    const remove = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Remove ${name}`, onclick: () => { siblings.splice(index, 1); rerender(); } }, 'Remove');
    const addChild = depth === 0 && (r.children?.length ?? 0) < 10 ? h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { (r.children ??= []).push(toRow({ id: itemId(), label: 'Dropdown link', link: { kind: 'url', url: 'https://' } }, `Item, dropdown`)); rerender(); } }, 'Add dropdown link') : null;
    return h('li', { class: 'list__item' }, h('span', { class: 'grow' }, r.label, r.link.el, kids), moveButtons(index, siblings.length, name, (a, b) => { arrayMove(siblings, a, b); rerender(); }), addChild, remove);
  };
  const rerender = () => {
    clear(list);
    if (rows.length === 0) list.appendChild(h('li', { class: 'empty' }, 'The menu is empty.'));
    rows.forEach((r, i) => list.appendChild(itemEl(r, rows, i, 0, rerender)));
  };
  rerender();

  const addPage = select([['', 'Add a page…'], ...state.pages.map((p): [string, string] => [p.id, p.title])], '');
  addPage.setAttribute('aria-label', 'Add a page to the menu');
  addPage.onchange = () => {
    const p = state.pages.find((x) => x.id === addPage.value);
    if (p) rows.push(toRow({ id: itemId(), label: p.title.slice(0, 60), link: pageLink(p.id) }, `Item ${rows.length + 1}`));
    addPage.value = '';
    rerender();
  };
  const addExternal = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { rows.push(toRow({ id: itemId(), label: 'Link', link: { kind: 'url', url: 'https://', newTab: true } }, `Item ${rows.length + 1}`)); rerender(); } }, 'Add external link');
  const save = h('button', { type: 'button', class: 'btn' }, 'Save navigation');
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  save.onclick = async () => {
    const leaf = (r: Row) => ({ id: r.id, label: r.label.value.trim() || labelOf(state, r.link.get()), link: r.link.get() });
    const items: NavItem[] = rows.map((r) => ({ ...leaf(r), ...(r.children?.length ? { children: r.children.map(leaf) } : {}) }));
    const next: SiteNav = { items, ...(state.nav.cta ? { cta: state.nav.cta } : {}) };
    const parsed = siteNavSchema.safeParse(next);
    error.hidden = parsed.success;
    if (!parsed.success) {
      error.textContent = parsed.error.issues.map((i) => `${i.path.join(' › ')}: ${i.message}`).join('; ');
      return;
    }
    if (await runSave(save, async () => saveNav(parsed.data), 'Navigation saved as draft')) await reload();
  };
  return card('Navigation menu', null, h('p', { class: 'field__hint' }, 'The links in the header, in order. A link can open a dropdown with one more level.'), list, error, h('div', { class: 'row' }, field('Add a page', addPage).el, addExternal, save));
}

const plain = (t: InlineText | undefined): string => (t ?? []).map((n) => (n.type === 'text' ? n.text : ' ')).join('');

function footerCard(state: State, reload: () => Promise<void>): HTMLElement {
  const f = state.footer;
  const original = plain(f.text);
  const textIn = textArea(original, 2, { maxlength: 300, 'aria-label': 'Footer text' });
  const socials = checkbox('Show social links', f.showSocials);
  const copyright = checkbox('Show the copyright line', f.showCopyright);
  const top = checkbox('Show a "Back to top" link', f.showBackToTop);
  const links: Row[] = f.links.map((l, i) => ({ id: l.id, label: textInput(l.label, { maxlength: 60, 'aria-label': `Footer link ${i + 1} label` }), link: linkEditor(state, l.link, `Footer link ${i + 1}`) }));
  const list = h('ul', { class: 'list', 'aria-label': 'Footer links' });
  const rerender = () => {
    clear(list);
    if (links.length === 0) list.appendChild(h('li', { class: 'empty' }, 'No footer links.'));
    links.forEach((r, i) =>
      list.appendChild(h('li', { class: 'list__item' }, h('span', { class: 'grow' }, r.label, r.link.el), moveButtons(i, links.length, r.label.value || 'link', (a, b) => { arrayMove(links, a, b); rerender(); }), h('button', { type: 'button', class: 'btn btn--ghost', 'aria-label': `Remove ${r.label.value || 'link'}`, onclick: () => { links.splice(i, 1); rerender(); } }, 'Remove'))),
    );
  };
  rerender();
  const add = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { links.push({ id: itemId(), label: textInput('Link', { maxlength: 60, 'aria-label': `Footer link ${links.length + 1} label` }), link: linkEditor(state, { kind: 'url', url: 'https://', newTab: true }, `Footer link ${links.length + 1}`) }); rerender(); } }, 'Add footer link');
  const save = h('button', { type: 'button', class: 'btn' }, 'Save footer');
  const error = h('p', { class: 'field__error', role: 'alert', hidden: true });
  save.onclick = async () => {
    const value = textIn.value.trim();
    const text: InlineText | undefined = value === original.trim() ? f.text : value ? [{ type: 'text', text: value }] : undefined;
    const next: SiteFooter = {
      ...(text?.length ? { text } : {}),
      links: links.map((r) => ({ id: r.id, label: r.label.value.trim() || labelOf(state, r.link.get()), link: r.link.get() })),
      showSocials: socials.input.checked,
      showCopyright: copyright.input.checked,
      showBackToTop: top.input.checked,
    };
    const parsed = siteFooterSchema.safeParse(next);
    error.hidden = parsed.success;
    if (!parsed.success) {
      error.textContent = parsed.error.issues.map((i) => `${i.path.join(' › ')}: ${i.message}`).join('; ');
      return;
    }
    if (await runSave(save, () => saveFooter(parsed.data), 'Footer saved as draft')) await reload();
  };
  return card('Footer', null, field('Footer text', textIn).el, socials.el, copyright.el, top.el, h('h3', {}, 'Footer links'), list, error, h('div', { class: 'row' }, add, save));
}
