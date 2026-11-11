/** Settings: site-wide details the visual editor does not edit (SEO defaults, contact email, social links, categories). */
import { categorySchema, siteSchema, socialSchema } from '../../lib/schema';
import { applyIssues, clear, field, h, kebab, textArea, textInput, type Field } from '../dom';
import { ok, stampText } from '../data';
import { sb } from '../supabase';
import { arrayMove, moveButtons, thumb, pickMedia } from '../widgets';
import type { ViewContext } from '../main';
import { card, runSave } from './shared';

export function renderSettings(el: HTMLElement, ctx: ViewContext): void {
  el.append(h('h1', {}, 'Settings'), siteCard(ctx), socialsCard(ctx), categoriesCard(ctx));
}

function siteCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const s = draft.site;
  const title = textInput(s.meta_title);
  const desc = textArea(s.meta_description, 3, { maxlength: 500 });
  const author = textInput(s.meta_author);
  const lang = textInput(s.meta_lang);
  const fields: Record<string, Field> = { title: field('Page title', title), description: field('Description (search and sharing)', desc), author: field('Author', author), lang: field('Language code', lang, 'For example en or es.') };
  let ogId = s.og_media_id;
  const ogThumb = h('div', {});
  const ogError = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const renderOg = () => {
    clear(ogThumb);
    ogThumb.append(h('h3', {}, 'Social share image'), thumb(draft.media.find((m) => m.id === ogId)), h('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => { const row = await pickMedia(draft, ['image'], () => {}); if (row) { ogId = row.id; renderOg(); } } }, 'Change social share image'));
  };
  renderOg();
  const save = h('button', { type: 'button', class: 'btn' }, 'Save site settings');
  save.onclick = () => {
    const og = draft.media.find((m) => m.id === ogId);
    const parsed = siteSchema.shape.meta.safeParse({ title: title.value, description: desc.value, author: author.value, ogImage: og?.storage_path ?? '', lang: lang.value });
    const issues = parsed.success ? [] : parsed.error.issues;
    applyIssues(fields, issues.filter((i) => i.path[0] !== 'ogImage'));
    ogError.hidden = !issues.some((i) => i.path[0] === 'ogImage');
    ogError.textContent = ogError.hidden ? '' : 'Choose a social share image.';
    if (!parsed.success) return;
    void runSave(save, async () => {
      ok(await sb().from('site').update({ meta_title: title.value.trim(), meta_description: desc.value.trim(), meta_author: author.value.trim(), meta_lang: lang.value.trim(), og_media_id: ogId }).eq('id', 1).select('id'));
      await ctx.refresh();
    });
  };
  return card('Site settings', stampText(s, draft), fields.title!.el, fields.description!.el, fields.author!.el, fields.lang!.el, ogThumb, ogError, save);
}


function socialsCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const email = textInput(draft.site.contact_email, { type: 'email' });
  const fields: Record<string, Field> = { email: field('Contact email', email, 'Used when you add a new contact section or page. Existing contact sections keep their own email: change it in the editor.') };
  const socials = draft.socials.map((s) => ({ id: s.id, label: s.label, url: s.url, isNew: false }));
  const listEl = h('ul', { class: 'list' });
  const socialErrors = h('p', { class: 'field__error', role: 'alert', hidden: true });

  const renderSocials = () => {
    clear(listEl);
    socials.forEach((s, i) => {
      const label = textInput(s.label, { 'aria-label': `Social ${i + 1} label` });
      const url = textInput(s.url, { type: 'url', 'aria-label': `Social ${i + 1} URL`, placeholder: 'https://' });
      label.oninput = () => (s.label = label.value);
      url.oninput = () => (s.url = url.value);
      listEl.appendChild(
        h(
          'li',
          { class: 'list__item' },
          h('div', { class: 'grow' }, label),
          h('div', { class: 'grow' }, url),
          moveButtons(i, socials.length, s.label || `social ${i + 1}`, (a, b) => {
            arrayMove(socials, a, b);
            renderSocials();
          }),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { socials.splice(i, 1); renderSocials(); } }, 'Remove'),
        ),
      );
    });
  };
  renderSocials();
  const add = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { socials.push({ id: '', label: '', url: '', isNew: true }); renderSocials(); } }, 'Add social link');

  const save = h('button', { type: 'button', class: 'btn' }, 'Save contact');
  save.onclick = () => {
    const rows = socials.map((s) => ({ id: s.id || kebab(s.label), label: s.label.trim(), url: s.url.trim() }));
    const parsed = siteSchema.shape.contact.pick({ email: true, socials: true }).safeParse({ email: email.value.trim(), socials: rows });
    const issues = parsed.success ? [] : parsed.error.issues;
    const socialIssues = issues.filter((i) => i.path[0] === 'socials');
    applyIssues(fields, issues.filter((i) => i.path[0] !== 'socials'));
    socialErrors.hidden = socialIssues.length === 0;
    socialErrors.textContent = socialIssues.map((i) => `Social ${Number(i.path[1]) + 1} ${String(i.path[2] ?? '')}: ${i.message}`).join('; ');
    const dup = new Set(rows.map((r) => r.id)).size !== rows.length;
    if (dup) {
      socialErrors.hidden = false;
      socialErrors.textContent = 'Two social links have the same name. Rename one.';
    }
    if (!parsed.success || dup) return;
    for (const r of rows) socialSchema.parse(r);
    void runSave(save, async () => {
      ok(await sb().from('site').update({ contact_email: email.value.trim() }).eq('id', 1).select('id'));
      const keep = rows.map((r) => r.id);
      const gone = draft.socials.map((s) => s.id).filter((id) => !keep.includes(id));
      if (gone.length) ok(await sb().from('socials').delete().in('id', gone).select('id'));
      if (rows.length) ok(await sb().from('socials').upsert(rows.map((r, position) => ({ ...r, position })), { onConflict: 'id' }).select('id'));
      await ctx.refresh();
    });
  };
  return card('Contact and social links', stampText(draft.site, draft), fields.email!.el, h('h3', {}, 'Social links'), listEl, socialErrors, h('div', { class: 'row' }, add, save));
}


function categoriesCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const rows = draft.categories.map((c) => ({ id: c.id, label: c.label, isNew: false }));
  const listEl = h('ul', { class: 'list' });
  const err = h('p', { class: 'field__error', role: 'alert', hidden: true });
  const render = () => {
    clear(listEl);
    rows.forEach((r, i) => {
      const label = textInput(r.label, { 'aria-label': `Category ${i + 1} name` });
      label.oninput = () => (r.label = label.value);
      listEl.appendChild(
        h(
          'li',
          { class: 'list__item' },
          h('div', { class: 'grow' }, label),
          h('span', { class: 'field__hint' }, r.isNew ? 'id from name' : `id: ${r.id}`),
          moveButtons(i, rows.length, r.label || `category ${i + 1}`, (a, b) => {
            arrayMove(rows, a, b);
            render();
          }),
          h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { rows.splice(i, 1); render(); } }, 'Remove'),
        ),
      );
    });
  };
  render();
  const add = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => { rows.push({ id: '', label: '', isNew: true }); render(); } }, 'Add category');
  const save = h('button', { type: 'button', class: 'btn' }, 'Save categories');
  save.onclick = () => {
    const out = rows.map((r) => ({ id: r.id || kebab(r.label), slug: r.id || kebab(r.label), label: r.label.trim() }));
    const problems: string[] = [];
    out.forEach((o, i) => {
      const p = categorySchema.safeParse(o);
      if (!p.success) problems.push(`Category ${i + 1}: ${p.error.issues[0]!.message}`);
    });
    if (new Set(out.map((o) => o.id)).size !== out.length) problems.push('Two categories have the same name.');
    if (out.length === 0) problems.push('Keep at least one category.');
    err.hidden = problems.length === 0;
    err.textContent = problems.join(' ');
    if (problems.length) return;
    void runSave(save, async () => {
      const gone = draft.categories.map((c) => c.id).filter((id) => !out.some((o) => o.id === id));
      ok(await sb().from('categories').upsert(out.map((o, position) => ({ ...o, position })), { onConflict: 'id' }).select('id'));
      if (gone.length) ok(await sb().from('categories').delete().in('id', gone).select('id'));
      await ctx.refresh();
    });
  };
  const stamp = draft.categories[0] ? stampText(draft.categories.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)), draft) : null;
  return card('Categories', stamp, listEl, err, h('div', { class: 'row' }, add, save));
}
