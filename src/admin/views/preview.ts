/**
 * Draft preview. The server returns `build_content(false)`: the same Content JSON the public site is built from.
 * It is validated with the content schema and drawn inside a script-less sandboxed iframe, using the public
 * site's tokens, global CSS and the same class names as the public Astro components.
 * (Astro components render at build time, so they cannot run in the browser: this mirrors their markup.)
 */
import { marked } from 'marked';
import globalCss from '../../styles/global.css?inline';
import tokensCss from '../../styles/tokens.css?inline';
import { siteSchema, worksSchema, type Media, type Site, type Work } from '../../lib/schema';
import { clear, h } from '../dom';
import { ok, signedUrls } from '../data';
import { sb } from '../supabase';
import type { ViewContext } from '../main';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const CSS = `
.media{position:relative;width:100%;overflow:hidden;background:var(--color-surface);border-radius:var(--radius-sm)}
.media img,.media video{width:100%;height:100%;object-fit:contain;display:block}
.media__badge{position:absolute;right:.75rem;bottom:.75rem;width:2rem;height:2rem;display:grid;place-items:center;border-radius:50%;background:var(--color-overlay);color:var(--color-on-overlay);font-size:.75rem}
.hero .media{border-radius:0;height:min(60vh,56.25vw);min-height:12rem}.hero .media img,.hero .media video{object-fit:cover}
.hero__text{padding-block:var(--space-6) var(--space-2)}.hero__title{font-size:var(--text-4xl)}.hero__sub{font-size:var(--text-lg);color:var(--color-muted)}
.work-grid{list-style:none;margin:0;padding:0;display:block;column-count:var(--cols-sm,1);column-gap:var(--grid-gap)}
@media(min-width:600px){.work-grid{column-count:var(--cols-md,2)}}@media(min-width:1024px){.work-grid{column-count:var(--cols-lg,3)}}
.work-grid:not(.work-grid--masonry){display:grid;column-count:auto;grid-template-columns:repeat(var(--cols-sm,1),1fr);gap:0 var(--grid-gap)}
@media(min-width:600px){.work-grid:not(.work-grid--masonry){grid-template-columns:repeat(var(--cols-md,2),1fr)}}@media(min-width:1024px){.work-grid:not(.work-grid--masonry){grid-template-columns:repeat(var(--cols-lg,3),1fr)}}
.tile{list-style:none;break-inside:avoid;margin:0 0 var(--grid-gap)}.tile__caption{display:flex;flex-direction:column;padding:.5rem 0}
.tile__title{font-family:var(--font-display);font-size:var(--text-lg)}.tile__meta{font-size:var(--text-xs);text-transform:uppercase;letter-spacing:var(--tracking-caps);color:var(--color-muted)}
.filters{display:flex;flex-wrap:wrap;gap:.5rem;margin-bottom:var(--space-5)}.chip{padding:.25rem 1rem;border-radius:999px;border:1px solid var(--color-border)}
.prose{max-width:var(--measure)}.about__inner{display:grid;gap:var(--space-6)}.about__portrait{max-width:22rem}
.contact{border-top:1px solid var(--color-border)}.contact__email{font-family:var(--font-display);font-size:var(--text-2xl)}
.contact__socials{display:flex;flex-wrap:wrap;gap:var(--space-5);list-style:none;padding:0}
.hidden-note{margin:0;padding:.5rem var(--gutter);background:#fff3cd;color:#664d03;font-size:.85rem}
`;

function mediaHtml(m: Media, urls: Map<string, string>, mode: 'tile' | 'hero' | 'detail'): string {
  const src = urls.get(m.src);
  const ratio = `aspect-ratio:${m.width}/${m.height}`;
  if (m.type === 'embed') {
    const poster = m.poster ? urls.get(m.poster) : undefined;
    return `<div class="media" style="${ratio}">${poster ? `<img src="${esc(poster)}" alt="${esc(m.alt)}">` : ''}<span class="media__badge" aria-hidden="true">▶</span></div>`;
  }
  if (!src) return `<div class="media" style="${ratio}"><p>Missing file ${esc(m.src)}</p></div>`;
  if (m.type === 'video') {
    return `<div class="media" style="${ratio}"><video src="${esc(src)}" poster="${esc(m.poster ? urls.get(m.poster) : '')}" ${mode === 'detail' ? 'controls' : 'muted'} aria-label="${esc(m.alt)}"></video></div>`;
  }
  return `<div class="media" style="${ratio}"><img src="${esc(src)}" alt="${esc(m.alt)}"></div>`;
}

function featuredWorks(site: Site, works: Work[]): Work[] {
  const opts = site.layout.sections.find((s) => s.id === 'featured')?.options as { workIds: string[]; limit?: number } | undefined;
  const byId = new Map(works.map((w) => [w.id, w]));
  const picked = (opts?.workIds ?? []).map((id) => byId.get(id)).filter((w): w is Work => Boolean(w));
  const list = picked.length ? picked : works.filter((w) => w.featured);
  return opts?.limit ? list.slice(0, opts.limit) : list;
}

export function previewHtml(site: Site, works: Work[], urls: Map<string, string>): string {
  const catOf = (w: Work) => site.categories.find((c) => c.id === w.categoryId)?.label ?? '';
  const tile = (w: Work) => `<li class="tile">${mediaHtml(w.media, urls, 'tile')}<span class="tile__caption"><span class="tile__title">${esc(w.title)}</span><span class="tile__meta">${esc([catOf(w), w.year].filter(Boolean).join(' · '))}</span></span></li>`;
  const out: string[] = [];
  for (const s of site.layout.sections.filter((x) => x.visible)) {
    if (s.id === 'hero') {
      out.push(`<section class="hero"><div class="hero__media">${mediaHtml(site.hero.media, urls, 'hero')}</div><div class="container hero__text"><h1 class="hero__title">${esc(site.hero.heading)}</h1>${site.hero.subheading ? `<p class="hero__sub">${esc(site.hero.subheading)}</p>` : ''}</div></section>`);
    } else if (s.id === 'featured') {
      out.push(`<section class="section"><div class="container"><h2 class="section__title">Featured</h2><ul class="work-grid work-grid--masonry">${featuredWorks(site, works).map(tile).join('')}</ul></div></section>`);
    } else if (s.id === 'grid') {
      const o = s.options ?? {};
      const cols = o.columns ?? { sm: 1, md: 2, lg: 3 };
      out.push(
        `<section class="section"><div class="container"><h2 class="section__title">Work</h2>${(o.showFilters ?? true) ? `<div class="filters"><span class="chip">All</span>${site.categories.map((c) => `<span class="chip">${esc(c.label)}</span>`).join('')}</div>` : ''}<ul class="work-grid ${(o.masonry ?? true) ? 'work-grid--masonry' : ''}" style="--cols-sm:${cols.sm};--cols-md:${cols.md};--cols-lg:${cols.lg}">${works.map(tile).join('')}</ul></div></section>`,
      );
    } else if (s.id === 'about') {
      out.push(`<section class="section about"><div class="container about__inner">${site.about.portrait ? `<div class="about__portrait">${mediaHtml(site.about.portrait, urls, 'detail')}</div>` : ''}<div><h2 class="section__title">${esc(site.about.heading)}</h2><div class="prose">${marked.parse(site.about.body, { async: false })}</div></div></div></section>`);
    } else if (s.id === 'contact') {
      out.push(`<section class="section contact"><div class="container"><h2 class="section__title">${esc(site.contact.heading)}</h2><p class="contact__email">${esc(site.contact.email)}</p><p><span class="btn">${esc(site.contact.ctaLabel)}</span></p><ul class="contact__socials">${site.contact.socials.map((x) => `<li>${esc(x.label)}</li>`).join('')}</ul></div></section>`);
    }
  }
  return `<!doctype html><html lang="${esc(site.meta.lang)}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${tokensCss}${globalCss}${CSS}</style><body><p class="hidden-note">Draft preview: ${works.length} work(s). Draft and unpublished works are included; archived works are hidden.</p>${out.join('')}</body></html>`;
}

export async function renderPreview(el: HTMLElement, ctx: ViewContext): Promise<void> {
  const frameHost = h('div', {});
  const problems = h('div', { role: 'alert' });
  let mobile = false;

  const draw = async () => {
    clear(frameHost);
    clear(problems);
    const content = ok(await sb().rpc('build_content', { p_published_only: false })) as { site: unknown; works: unknown };
    const site = siteSchema.safeParse(content.site);
    const works = worksSchema.safeParse(content.works);
    if (!site.success || !works.success) {
      const issues = [...(site.success ? [] : site.error.issues.map((i) => `site.${i.path.join('.')}: ${i.message}`)), ...(works.success ? [] : works.error.issues.map((i) => `works.${i.path.join('.')}: ${i.message}`))];
      problems.append(h('p', { class: 'field__error' }, 'The draft does not pass validation yet, so it cannot be previewed:'), h('ul', {}, ...issues.map((i) => h('li', {}, i))));
      return;
    }
    const paths = new Set<string>();
    const collect = (m?: Media) => {
      if (!m) return;
      if (m.type !== 'embed') paths.add(m.src);
      if (m.poster) paths.add(m.poster);
    };
    collect(site.data.hero.media);
    collect(site.data.about.portrait);
    for (const w of works.data) {
      collect(w.media);
      w.gallery?.forEach(collect);
    }
    const urls = await signedUrls([...paths]);
    frameHost.appendChild(
      h('iframe', { class: `preview-frame${mobile ? ' preview-frame--mobile' : ''}`, title: 'Draft preview of the home page', sandbox: '', srcdoc: previewHtml(site.data, works.data, urls) }),
    );
  };

  const refresh = h('button', { type: 'button', class: 'btn btn--ghost', onclick: () => void ctx.refresh() }, 'Refresh preview');
  const toggle = h('button', { type: 'button', class: 'btn btn--ghost', 'aria-pressed': 'false', onclick: () => { mobile = !mobile; toggle.setAttribute('aria-pressed', String(mobile)); void draw(); } }, 'Phone width');
  el.append(h('h1', {}, 'Preview'), h('div', { class: 'row' }, refresh, toggle), problems, frameHost);
  await draw();
}
