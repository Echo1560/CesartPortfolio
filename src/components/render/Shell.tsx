/**
 * Entry points of the shared renderer. Each one wraps its tree in the render
 * context, so an Astro page (or, later, the editor canvas) renders them with
 * one prop and no `client:*` directive: the output is static HTML.
 */
import type { ComponentChildren, VNode } from 'preact';
import { visibleSections, withBase } from '../../lib/render-model';
import type { SnapshotPage, SnapshotV3 } from '../../lib/schema-v3';
import type { Category, Work } from '../../lib/schema';
import { ButtonLink } from './ButtonLink';
import { Inline } from './RichText';
import { Lightbox } from './Lightbox';
import { RenderCtx, useLink, useRender, type RenderContext } from './context';
import { About } from './sections/About';
import { Columns } from './sections/Columns';
import { Contact } from './sections/Contact';
import { Cta } from './sections/Cta';
import { Featured } from './sections/Featured';
import { Gallery } from './sections/Gallery';
import { Hero } from './sections/Hero';
import { Image } from './sections/Image';
import { Spacer } from './sections/Spacer';
import { Text } from './sections/Text';
import { WorksList } from './sections/WorksList';
import { asSection, sectionsOf, type LooseSection } from './types';
import { WorkDetail } from './WorkDetail';

/** Builds the context from a validated snapshot. `media` is filled by the caller (build: `lib/render-media.ts`). */
export function createRenderContext(snapshot: SnapshotV3, base: string, media: RenderContext['media'], page?: SnapshotPage): RenderContext {
  return {
    base,
    site: snapshot.site,
    pages: snapshot.pages.filter((p) => p.status === 'published'),
    works: snapshot.works,
    categories: snapshot.site.categories,
    page,
    media,
  };
}

export function SectionView({ section }: { section: LooseSection }): VNode | null {
  switch (section.type) {
    case 'hero':
      return <Hero section={asSection<'hero'>(section)} />;
    case 'text':
      return <Text section={asSection<'text'>(section)} />;
    case 'image':
      return <Image section={asSection<'image'>(section)} />;
    case 'gallery':
      return <Gallery section={asSection<'gallery'>(section)} />;
    case 'featured':
      return <Featured section={asSection<'featured'>(section)} />;
    case 'about':
      return <About section={asSection<'about'>(section)} />;
    case 'contact':
      return <Contact section={asSection<'contact'>(section)} />;
    case 'columns':
      return <Columns section={asSection<'columns'>(section)} />;
    case 'spacer':
      return <Spacer section={asSection<'spacer'>(section)} />;
    case 'cta':
      return <Cta section={asSection<'cta'>(section)} />;
    case 'works-list':
      return <WorksList section={asSection<'works-list'>(section)} />;
  }
}

/** Section types that render work tiles, which the lightbox opens. */
const TILE_SECTIONS: readonly string[] = ['gallery', 'featured'];

/** Sections of the context's page, as direct children of `<main>`. */
export function PageView({ sections }: { sections?: LooseSection[] }): VNode {
  const { page, works } = useRender();
  const list = sections ?? (page ? visibleSections(sectionsOf(page)) : []);
  const tiles = list.some((s) => TILE_SECTIONS.includes(s.type));
  return (
    <>
      {list
        .map((s) => (
          <SectionView key={s.id} section={s} />
        ))}
      {tiles && <Lightbox works={works} />}
    </>
  );
}

function Root({ ctx, children }: { ctx: RenderContext; children: ComponentChildren }): VNode {
  return <RenderCtx.Provider value={ctx}>{children}</RenderCtx.Provider>;
}

/** The sections of one page. Render inside `<main>`. */
export function PageRoot({ ctx }: { ctx: RenderContext }): VNode {
  return (
    <Root ctx={ctx}>
      <PageView />
    </Root>
  );
}

/** A work detail page body (`variant="page"`). */
export function WorkRoot({ ctx, work, category }: { ctx: RenderContext; work: Work; category?: Category }): VNode {
  return (
    <Root ctx={ctx}>
      <WorkDetail work={work} category={category} variant="page" />
    </Root>
  );
}

function Header(): VNode {
  const { site, base, page } = useRender();
  const resolve = useLink();
  const items = site.nav.items.flatMap((item) => {
    const target = resolve(item.link);
    if (!target) return [];
    const children = (item.children ?? []).flatMap((c) => {
      const t = resolve(c.link);
      return t ? [{ ...c, href: t.href, newTab: t.newTab }] : [];
    });
    return [{ ...item, href: target.href, newTab: target.newTab, children }];
  });
  const current = (href: string) => (page && href === withBase(base, page.isHome ? '' : `${page.slug}/`) ? ('page' as const) : undefined);
  const list = (
    <ul>
      {items.map((item) => (
        <li key={item.id} class={item.children.length ? 'has-children' : undefined}>
          <a href={item.href} aria-current={current(item.href)} {...(item.newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
            {item.label}
          </a>
          {item.children.length > 0 && (
            <ul class="site-header__sub">
              {item.children.map((c) => (
                <li key={c.id}>
                  <a href={c.href} aria-current={current(c.href)}>
                    {c.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <header class="site-header" data-site-header>
      <div class="container site-header__inner">
        <a class="site-header__brand" href={withBase(base, '')}>
          {site.meta.author}
        </a>
        <nav class="site-header__nav" aria-label="Primary">
          {items.length > 0 && <div class="site-header__list">{list}</div>}
          {items.length > 0 && (
            <details class="site-header__menu">
              <summary>Menu</summary>
              {list}
            </details>
          )}
          {site.nav.cta && <ButtonLink button={site.nav.cta} class="site-header__cta" trackSource="header" />}
        </nav>
      </div>
    </header>
  );
}

export function HeaderRoot({ ctx }: { ctx: RenderContext }): VNode {
  return (
    <Root ctx={ctx}>
      <Header />
    </Root>
  );
}

function Footer({ year }: { year: number }): VNode {
  const { site } = useRender();
  const resolve = useLink();
  const f = site.footer;
  const links = f.links.flatMap((l) => {
    const t = resolve(l.link);
    return t ? [{ ...l, href: t.href }] : [];
  });
  return (
    <footer class="site-footer">
      <div class="container site-footer__inner">
        {f.showCopyright && (
          <p>
            © {year} {site.meta.author}. All rights reserved.
          </p>
        )}
        {f.text && f.text.length > 0 && (
          <p>
            <Inline text={f.text} />
          </p>
        )}
        {links.length > 0 && (
          <ul class="site-footer__links" aria-label="Footer">
            {links.map((l) => (
              <li key={l.id}>
                <a href={l.href}>{l.label}</a>
              </li>
            ))}
          </ul>
        )}
        {f.showSocials && site.socials.length > 0 && (
          <ul class="site-footer__links" aria-label="Social links">
            {site.socials.map((s) => (
              <li key={s.id}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        )}
        {f.showBackToTop && <a href="#top">Back to top</a>}
      </div>
    </footer>
  );
}

export function FooterRoot({ ctx, year }: { ctx: RenderContext; year: number }): VNode {
  return (
    <Root ctx={ctx}>
      <Footer year={year} />
    </Root>
  );
}
