/** Content: hero, about, contact and socials, site settings and categories. */
import { marked } from 'marked';
import { categorySchema, siteSchema, socialSchema } from '../../lib/schema';
import { applyIssues, checkbox, clear, field, h, kebab, textArea, textInput, type Field } from '../dom';
import { ok, placementToValue, removePlacement, saveSinglePlacement, stampText, valueToMedia, type Draft } from '../data';
import { sb } from '../supabase';
import { arrayMove, mediaField, moveButtons, thumb, pickMedia } from '../widgets';
import type { ViewContext } from '../main';
import { card, runSave } from './shared';

export function renderContent(el: HTMLElement, ctx: ViewContext): void {
  el.append(h('h1', {}, 'Content'), heroCard(ctx), aboutCard(ctx), contactCard(ctx), siteCard(ctx), categoriesCard(ctx));
}

function placementOf(draft: Draft, slot: 'hero' | 'about_portrait') {
  return draft.placements.find((p) => p.slot === slot);
}

function heroCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const heading = textInput(draft.site.hero_heading);
  const sub = textInput(draft.site.hero_subheading);
  const fields: Record<string, Field> = { heading: field('Heading', heading), subheading: field('Subheading', sub) };
  const existing = placementOf(draft, 'hero');
  const media = mediaField(draft, 'Hero media', placementToValue(existing));
  const save = h('button', { type: 'button', class: 'btn' }, 'Save hero');
  save.onclick = () => {
    const value = media.get();
    const parsed = siteSchema.shape.hero.safeParse({ heading: heading.value, subheading: sub.value, media: valueToMedia(value, draft.media) });
    const mediaIssues = parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] === 'media').map((i) => ({ path: i.path.slice(1), message: i.message }));
    const own = parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] !== 'media');
    applyIssues(fields, own);
    media.showIssues(mediaIssues);
    if (!parsed.success) return;
    void runSave(save, async () => {
      ok(await sb().from('site').update({ hero_heading: heading.value.trim(), hero_subheading: sub.value }).eq('id', 1).select('id'));
      await saveSinglePlacement('hero', null, existing, value);
      await ctx.refresh();
    });
  };
  return card('Hero', stampText(draft.site, draft), fields.heading!.el, fields.subheading!.el, media.el, save);
}

function mdPreview(source: HTMLTextAreaElement): HTMLIFrameElement {
  // Sandboxed with no permissions: Markdown can contain raw HTML, but it can never run script here.
  const frame = h('iframe', { sandbox: '', title: 'Markdown preview', 'aria-label': 'Markdown preview' });
  const update = () => {
    frame.srcdoc = `<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui;margin:12px;color:#1b1b1a}img{max-width:100%}</style>${marked.parse(source.value, { async: false })}`;
  };
  source.addEventListener('input', update);
  update();
  return frame;
}

function aboutCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const heading = textInput(draft.site.about_heading);
  const body = textArea(draft.site.about_body, 10, { maxlength: 20000 });
  const fields: Record<string, Field> = { heading: field('Heading', heading), body: field('Text (Markdown)', body, 'Blank line = new paragraph. **bold**, *italic*, [link](https://…).') };
  const existing = placementOf(draft, 'about_portrait');
  const media = mediaField(draft, 'Portrait', placementToValue(existing));
  const show = checkbox('Show a portrait', Boolean(existing));
  const mediaWrap = h('div', { hidden: !existing }, media.el);
  show.input.onchange = () => (mediaWrap.hidden = !show.input.checked);
  const save = h('button', { type: 'button', class: 'btn' }, 'Save about');
  save.onclick = () => {
    const value = media.get();
    const parsed = siteSchema.shape.about.safeParse({ heading: heading.value, body: body.value, portrait: show.input.checked ? valueToMedia(value, draft.media) : undefined });
    const mediaIssues = parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] === 'portrait').map((i) => ({ path: i.path.slice(1), message: i.message }));
    applyIssues(fields, parsed.success ? [] : parsed.error.issues.filter((i) => i.path[0] !== 'portrait'));
    media.showIssues(mediaIssues);
    if (!parsed.success) return;
    void runSave(save, async () => {
      ok(await sb().from('site').update({ about_heading: heading.value.trim(), about_body: body.value }).eq('id', 1).select('id'));
      if (show.input.checked) await saveSinglePlacement('about_portrait', null, existing, value);
      else if (existing) await removePlacement(existing.id);
      await ctx.refresh();
    });
  };
  return card('About', stampText(draft.site, draft), fields.heading!.el, h('div', { class: 'md' }, fields.body!.el, mdPreview(body)), show.el, mediaWrap, save);
}

function contactCard(ctx: ViewContext): HTMLElement {
  const { draft } = ctx;
  const heading = textInput(draft.site.contact_heading);
  const email = textInput(draft.site.contact_email, { type: 'email' });
  const cta = textInput(draft.site.contact_cta_label);
  const fields: Record<string, Field> = { heading: field('Heading', heading), email: field('Email', email), ctaLabel: field('Button label', cta) };
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
    const parsed = siteSchema.shape.contact.safeParse({ heading: heading.value, email: email.value.trim(), ctaLabel: cta.value, socials: rows });
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
      ok(await sb().from('site').update({ contact_heading: heading.value.trim(), contact_email: email.value.trim(), contact_cta_label: cta.value.trim() }).eq('id', 1).select('id'));
      const keep = rows.map((r) => r.id);
      const gone = draft.socials.map((s) => s.id).filter((id) => !keep.includes(id));
      if (gone.length) ok(await sb().from('socials').delete().in('id', gone).select('id'));
      if (rows.length) ok(await sb().from('socials').upsert(rows.map((r, position) => ({ ...r, position })), { onConflict: 'id' }).select('id'));
      await ctx.refresh();
    });
  };
  return card('Contact and socials', stampText(draft.site, draft), fields.heading!.el, fields.email!.el, fields.ctaLabel!.el, h('h3', {}, 'Social links'), listEl, socialErrors, h('div', { class: 'row' }, add, save));
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
  const renderOg = () => {
    clear(ogThumb);
    ogThumb.append(thumb(draft.media.find((m) => m.id === ogId)), h('button', { type: 'button', class: 'btn btn--ghost', onclick: async () => { const row = await pickMedia(draft, ['image'], () => {}); if (row) { ogId = row.id; renderOg(); } } }, 'Change social share image'));
  };
  renderOg();
  const save = h('button', { type: 'button', class: 'btn' }, 'Save site settings');
  save.onclick = () => {
    const og = draft.media.find((m) => m.id === ogId);
    const parsed = siteSchema.shape.meta.safeParse({ title: title.value, description: desc.value, author: author.value, ogImage: og?.storage_path ?? '', lang: lang.value });
    applyIssues(fields, parsed.success ? [] : parsed.error.issues.map((i) => ({ ...i, path: i.path[0] === 'ogImage' ? ['title'] : i.path })));
    if (!parsed.success) return;
    void runSave(save, async () => {
      ok(await sb().from('site').update({ meta_title: title.value.trim(), meta_description: desc.value.trim(), meta_author: author.value.trim(), meta_lang: lang.value.trim(), og_media_id: ogId }).eq('id', 1).select('id'));
      await ctx.refresh();
    });
  };
  return card('Site settings', stampText(s, draft), fields.title!.el, fields.description!.el, fields.author!.el, fields.lang!.el, ogThumb, save);
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
