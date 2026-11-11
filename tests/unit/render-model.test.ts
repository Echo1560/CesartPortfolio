import { describe, expect, it } from 'vitest';
import {
  compareWorks,
  featuredWorks,
  isExternalUrl,
  isHiddenEverywhere,
  pageHref,
  pageSeo,
  publishedPages,
  resolveLink,
  safeSocials,
  safeUrl,
  selectWorks,
  visibilityClasses,
  visibleSections,
  withBase,
  workHref,
} from '../../src/lib/render-model';
import type { Category, Work } from '../../src/lib/schema';
import type { SnapshotPage, SnapshotV3 } from '../../src/lib/schema-v3';

const BASE = '/CesartPortfolio/';
const work = (id: string, extra: Partial<Work> = {}): Work =>
  ({ id, slug: id, title: id, categoryId: 'ink', tags: [], description: '', media: {}, ...extra }) as unknown as Work;
const page = (id: string, slug: string, extra: Record<string, unknown> = {}): SnapshotPage =>
  ({ id, slug, title: slug, isHome: false, status: 'published', seo: {}, sections: [], ...extra }) as unknown as SnapshotPage;

const home = page('p-home', 'home', { isHome: true });
const about = page('p-about', 'about');
const works = [work('a', { year: 2020, order: 2, tags: ['Cat'] }), work('b', { year: 2023, categoryId: 'color' }), work('c', { order: 1, featured: true })];
const lookup = { base: BASE, pages: [home, about], works };
const visible = { desktop: true, tablet: true, mobile: true };
const ids = (list: Work[]) => list.map((w) => w.id);

describe('hrefs', () => {
  it('joins base and path without a double slash', () => {
    expect(withBase('/x', '/y')).toBe('/x/y');
    expect(withBase(BASE, '')).toBe(BASE);
  });
  it('gives the home page the bare base and others a trailing slash', () => {
    expect(pageHref(BASE, home)).toBe(BASE);
    expect(pageHref(BASE, about)).toBe('/CesartPortfolio/about/');
  });
  it('builds work detail hrefs', () => {
    expect(workHref(BASE, 'dragon')).toBe('/CesartPortfolio/work/dragon/');
  });
  it('adds the base to site paths and leaves absolute urls alone', () => {
    expect(safeUrl(BASE, '/about/')).toBe('/CesartPortfolio/about/');
    expect(safeUrl(BASE, 'https://example.com')).toBe('https://example.com');
    expect(safeUrl(BASE, '#top')).toBe('#top');
  });
  it('rejects javascript: and data: urls', () => {
    expect(safeUrl(BASE, 'javascript:alert(1)')).toBeUndefined();
    expect(safeUrl(BASE, 'data:text/html,x')).toBeUndefined();
  });
  it('detects external urls', () => {
    expect(isExternalUrl('https://a.b')).toBe(true);
    expect(isExternalUrl('mailto:a@b.c')).toBe(false);
  });
});

describe('resolveLink', () => {
  it('resolves a page link, with an anchor', () => {
    expect(resolveLink({ kind: 'page', pageId: 'p-about', anchor: 'team' }, lookup)).toEqual({ href: '/CesartPortfolio/about/#team', newTab: false });
  });
  it('uses a plain anchor for the current page', () => {
    expect(resolveLink({ kind: 'page', pageId: 'p-about' }, lookup, 'p-about')?.href).toBe('#top');
    expect(resolveLink({ kind: 'page', pageId: 'p-about', anchor: 'x' }, lookup, 'p-about')?.href).toBe('#x');
  });
  it('skips a link to a page that is not in the snapshot', () => {
    expect(resolveLink({ kind: 'page', pageId: 'gone' }, lookup)).toBeUndefined();
  });
  it('resolves and skips work links', () => {
    expect(resolveLink({ kind: 'work', workId: 'a' }, lookup)?.href).toBe('/CesartPortfolio/work/a/');
    expect(resolveLink({ kind: 'work', workId: 'gone' }, lookup)).toBeUndefined();
  });
  it('resolves anchor links', () => {
    expect(resolveLink({ kind: 'anchor', anchor: 'contact' }, lookup)).toEqual({ href: '#contact', newTab: false });
  });
  it('honours newTab on url links and drops unsafe ones', () => {
    expect(resolveLink({ kind: 'url', url: 'https://x.y', newTab: true }, lookup)).toEqual({ href: 'https://x.y', newTab: true });
    expect(resolveLink({ kind: 'url', url: 'javascript:1' } as never, lookup)).toBeUndefined();
  });
});

describe('work selection', () => {
  const categories = [] as Category[];
  it('orders by order, then newest year, then title', () => {
    expect(ids(works.slice().sort(compareWorks))).toEqual(['c', 'a', 'b']);
  });
  it('selects all works in default order', () => {
    expect(ids(selectWorks(works, categories, { kind: 'all' }, 'default'))).toEqual(['c', 'a', 'b']);
  });
  it('filters by category and ignores unknown categories', () => {
    expect(ids(selectWorks(works, categories, { kind: 'category', categoryIds: ['color'] }, 'default'))).toEqual(['b']);
    expect(selectWorks(works, categories, { kind: 'category', categoryIds: ['nope'] }, 'default')).toEqual([]);
  });
  it('filters by tag, case-insensitively', () => {
    expect(ids(selectWorks(works, categories, { kind: 'tags', tags: ['cAt'] }, 'default'))).toEqual(['a']);
  });
  it('keeps the manual order and skips unknown ids', () => {
    expect(ids(selectWorks(works, categories, { kind: 'manual', workIds: ['b', 'zzz', 'a'] }, 'default'))).toEqual(['b', 'a']);
  });
  it('lets an explicit sort override the manual order', () => {
    expect(ids(selectWorks(works, categories, { kind: 'manual', workIds: ['a', 'b'] }, 'newest'))).toEqual(['b', 'a']);
    expect(ids(selectWorks(works, categories, { kind: 'all' }, 'oldest'))[0]).toBe('a');
    expect(ids(selectWorks(works, categories, { kind: 'all' }, 'title'))).toEqual(['a', 'b', 'c']);
  });
  it('applies the limit', () => {
    expect(selectWorks(works, categories, { kind: 'all' }, 'default', 2)).toHaveLength(2);
  });
  it('does not mutate the input', () => {
    const copy = works.slice();
    selectWorks(works, categories, { kind: 'all' }, 'title');
    expect(works).toEqual(copy);
  });
});

describe('featuredWorks', () => {
  it('uses the listed ids in order', () => {
    expect(ids(featuredWorks(works, ['b', 'a']))).toEqual(['b', 'a']);
  });
  it('falls back to works flagged featured when no ids are listed', () => {
    expect(ids(featuredWorks(works, []))).toEqual(['c']);
  });
  it('applies the cap', () => {
    expect(featuredWorks(works, ['a', 'b', 'c'], 1)).toHaveLength(1);
  });
});

describe('safeSocials', () => {
  it('drops unsafe urls and adds the resolved href', () => {
    const out = safeSocials([{ url: 'https://i.g/x' }, { url: 'javascript:alert(1)' }], BASE);
    expect(out).toEqual([{ url: 'https://i.g/x', href: 'https://i.g/x' }]);
  });
});

describe('visibility', () => {
  it('detects hidden-everywhere', () => {
    expect(isHiddenEverywhere({ desktop: false, tablet: false, mobile: false })).toBe(true);
    expect(isHiddenEverywhere({ desktop: false, tablet: true, mobile: false })).toBe(false);
  });
  it('filters sections hidden on every device', () => {
    const s = [
      { id: 1, visibility: visible },
      { id: 2, visibility: { desktop: false, tablet: false, mobile: false } },
    ];
    expect(visibleSections(s).map((x) => x.id)).toEqual([1]);
  });
  it('emits a hide class for each device that is off', () => {
    expect(visibilityClasses(visible)).toEqual([]);
    expect(visibilityClasses({ desktop: false, tablet: true, mobile: false })).toEqual(['hide-desktop', 'hide-mobile']);
  });
});

describe('page seo and published pages', () => {
  const snap = { site: { meta: { title: 'Cesart', author: 'Cesart', description: 'Site desc', ogImage: 'og.png' } } } as unknown as SnapshotV3;
  it('falls back to site defaults', () => {
    expect(pageSeo(snap, home)).toEqual({ title: 'Cesart', description: 'Site desc', image: 'og.png' });
    expect(pageSeo(snap, about).title).toBe('about — Cesart');
  });
  it('prefers the page seo', () => {
    const p = page('x', 'x', { seo: { title: 'T', description: 'D', ogImage: 'i.png' } });
    expect(pageSeo(snap, p)).toEqual({ title: 'T', description: 'D', image: 'i.png' });
  });
  it('keeps only published pages', () => {
    const pages = [home, page('d', 'd', { status: 'draft' }), page('h', 'h', { status: 'hidden' })];
    expect(publishedPages({ pages })).toEqual([home]);
  });
});
