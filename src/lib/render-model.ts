/**
 * Pure helpers shared by the public renderer and the editor canvas: links,
 * work selection, visibility and per-page SEO. No Astro, no I/O.
 * Contract: docs/V3-CONTRACTS.md §3 and §5.
 */
import { safeHref, type Link, type SnapshotPage, type SnapshotV3, type Visibility, type WorkSource } from './schema-v3';
import type { Category, Work } from './schema';

/** What link and work resolution needs to know about the site. */
export interface SiteLookup {
  /** Site base, ending in `/` (`/CesartPortfolio/`). */
  base: string;
  pages: SnapshotPage[];
  works: Work[];
}

export interface ResolvedLink {
  href: string;
  newTab: boolean;
}

/** `base` + a site path, without a double slash. */
export function withBase(base: string, path: string): string {
  return base.replace(/\/*$/, '/') + path.replace(/^\/+/, '');
}

export function pageHref(base: string, page: Pick<SnapshotPage, 'slug' | 'isHome'>): string {
  return page.isHome ? withBase(base, '') : withBase(base, `${page.slug}/`);
}

export function workHref(base: string, slug: string): string {
  return withBase(base, `work/${slug}/`);
}

export function isSafeHref(href: string): boolean {
  return safeHref.safeParse(href).success;
}

/**
 * Re-checks a rich-text/link href at render time (contract §3.4) and gives
 * site paths the base. Returns undefined for anything unsafe.
 */
export function safeUrl(base: string, href: string): string | undefined {
  if (!isSafeHref(href)) return undefined;
  return href.startsWith('/') ? withBase(base, href) : href;
}

export function isExternalUrl(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

/**
 * Turns a `Link` into an href. Returns undefined when the target is not in the
 * snapshot (a hidden page, a removed work): the renderer skips such links
 * instead of failing the build (contract §5).
 */
export function resolveLink(link: Link, lookup: SiteLookup, currentPageId?: string): ResolvedLink | undefined {
  switch (link.kind) {
    case 'page': {
      const target = lookup.pages.find((p) => p.id === link.pageId);
      if (!target) return undefined;
      const hash = link.anchor ? `#${link.anchor}` : '';
      // Same page: a plain anchor keeps scrolling smooth and tracking correct.
      if (target.id === currentPageId) return { href: hash || '#top', newTab: false };
      return { href: pageHref(lookup.base, target) + hash, newTab: false };
    }
    case 'work': {
      const work = lookup.works.find((w) => w.id === link.workId);
      return work ? { href: workHref(lookup.base, work.slug), newTab: false } : undefined;
    }
    case 'anchor':
      return { href: `#${link.anchor}`, newTab: false };
    case 'url': {
      const href = safeUrl(lookup.base, link.url);
      return href ? { href, newTab: Boolean(link.newTab) } : undefined;
    }
  }
}

/** v2 order: `order` ascending (missing last), then newest year, then title. */
export function compareWorks(a: Work, b: Work): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA < orderB ? -1 : 1;
  const yearA = a.year ?? Number.NEGATIVE_INFINITY;
  const yearB = b.year ?? Number.NEGATIVE_INFINITY;
  if (yearA !== yearB) return yearA > yearB ? -1 : 1;
  return a.title.localeCompare(b.title);
}

const SORTS = {
  newest: (a: Work, b: Work) => (b.year ?? 0) - (a.year ?? 0) || compareWorks(a, b),
  oldest: (a: Work, b: Work) => (a.year ?? 9999) - (b.year ?? 9999) || compareWorks(a, b),
  title: (a: Work, b: Work) => a.title.localeCompare(b.title),
} as const;

/**
 * The works a gallery or works list shows. Unknown ids, categories and tags
 * match nothing (skipped, never an error). `manual` keeps the listed order
 * unless a sort other than `default` is chosen.
 */
export function selectWorks(
  works: Work[],
  categories: Category[],
  source: WorkSource,
  sort: 'default' | 'newest' | 'oldest' | 'title',
  limit?: number,
): Work[] {
  let picked: Work[];
  switch (source.kind) {
    case 'all':
      picked = [...works];
      break;
    case 'category': {
      const ids = new Set(source.categoryIds);
      picked = works.filter((w) => ids.has(w.categoryId));
      break;
    }
    case 'tags': {
      const tags = new Set(source.tags.map((t) => t.toLowerCase()));
      picked = works.filter((w) => w.tags.some((t) => tags.has(t.toLowerCase())));
      break;
    }
    case 'manual':
      picked = source.workIds.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => w !== undefined);
      break;
  }
  if (sort !== 'default') picked.sort(SORTS[sort]);
  else if (source.kind !== 'manual') picked.sort(compareWorks);
  return limit ? picked.slice(0, limit) : picked;
}

/** Works of a `featured` section: `workIds` in order; falls back to works flagged `featured` (v2) when none are listed. */
export function featuredWorks(works: Work[], workIds: string[], limit?: number): Work[] {
  const picked = workIds.length
    ? workIds.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => w !== undefined)
    : works.filter((w) => w.featured).sort(compareWorks);
  return limit ? picked.slice(0, limit) : picked;
}

/** Social links whose URL passes the safe-href check (defence in depth: `z.url()` also accepts `javascript:`). */
export function safeSocials<S extends { url: string }>(socials: S[], base: string): (S & { href: string })[] {
  return socials.flatMap((s) => {
    const href = safeUrl(base, s.url);
    return href ? [{ ...s, href }] : [];
  });
}

export function isHiddenEverywhere(v: Visibility): boolean {
  return !v.desktop && !v.tablet && !v.mobile;
}

/** Sections that show on at least one device. The snapshot already drops the rest; this is the defensive check (contract §5). */
export function visibleSections<S extends { visibility: Visibility }>(sections: S[]): S[] {
  return sections.filter((s) => !isHiddenEverywhere(s.visibility));
}

/** CSS classes that hide an element on the devices where it is off. Breakpoints live in `site.css`. */
export function visibilityClasses(v: Visibility): string[] {
  return [!v.desktop && 'hide-desktop', !v.tablet && 'hide-tablet', !v.mobile && 'hide-mobile'].filter((c): c is string => Boolean(c));
}

export interface PageSeo {
  title: string;
  description: string;
  /** Bucket key of the social image. */
  image: string;
}

/** Per-page SEO falling back to the site defaults (contract §2, `pages`). The home page keeps the site title. */
export function pageSeo(snapshot: Pick<SnapshotV3, 'site'>, page: SnapshotPage): PageSeo {
  const { meta } = snapshot.site;
  return {
    title: page.seo.title || (page.isHome ? meta.title : `${page.title} — ${meta.author}`),
    description: page.seo.description || meta.description,
    image: page.seo.ogImage || meta.ogImage,
  };
}

/** Published pages only (the snapshot is already in nav order). */
export function publishedPages(snapshot: Pick<SnapshotV3, 'pages'>): SnapshotPage[] {
  return snapshot.pages.filter((p) => p.status === 'published');
}
