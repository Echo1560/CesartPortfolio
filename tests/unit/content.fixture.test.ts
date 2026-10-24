import { beforeAll, describe, expect, it, vi } from 'vitest';
import siteFixture from '../fixtures/site.json';
import worksFixture from '../fixtures/works.json';

// content.ts is the only module that reads content/*.json; swap both files for
// the fixtures and pretend every media file exists.
vi.mock('../../content/site.json', () => ({ default: siteFixture }));
vi.mock('../../content/works.json', () => ({ default: worksFixture }));
vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  existsSync: () => true,
  statSync: () => ({ isFile: () => true }),
}));

type Content = typeof import('../../src/lib/content');
let content: Content;

beforeAll(async () => {
  content = await import('../../src/lib/content');
});

describe('getWorks', () => {
  it('sorts by order, then year descending, then works without year last', async () => {
    expect((await content.getWorks()).map((w) => w.id)).toEqual(['delta', 'gamma', 'beta', 'alpha']);
  });

  it('filters by categoryId and keeps the sort order', async () => {
    expect((await content.getWorks({ categoryId: 'illustration' })).map((w) => w.id)).toEqual(['gamma', 'alpha']);
  });

  it('filters by featured flag', async () => {
    expect((await content.getWorks({ featured: true })).map((w) => w.id)).toEqual(['beta', 'alpha']);
    expect((await content.getWorks({ featured: false })).map((w) => w.id)).toEqual(['delta', 'gamma']);
  });

  it('combines category and featured filters', async () => {
    expect((await content.getWorks({ categoryId: 'animation', featured: true })).map((w) => w.id)).toEqual(['beta']);
  });

  it('returns an empty list for an unknown category', async () => {
    expect(await content.getWorks({ categoryId: 'nope' })).toEqual([]);
  });
});

describe('getWork', () => {
  it('returns the work with the given slug', async () => {
    expect((await content.getWork('beta'))?.title).toBe('Beta');
  });

  it('returns undefined for an unknown slug', async () => {
    expect(await content.getWork('missing')).toBeUndefined();
  });
});

describe('getLayout', () => {
  it('returns the sections in configured order with visibility', async () => {
    const { sections } = await content.getLayout();
    expect(sections.map((s) => [s.id, s.visible])).toEqual([
      ['hero', true],
      ['featured', true],
      ['grid', true],
      ['about', false],
      ['contact', true],
    ]);
  });
});

describe('getCategories', () => {
  it('returns the categories from site.json', async () => {
    expect((await content.getCategories()).map((c) => c.slug)).toEqual(['illustration', 'animation']);
  });
});

describe('getFeaturedWorks', () => {
  it('follows layout workIds order and applies the limit', async () => {
    expect((await content.getFeaturedWorks()).map((w) => w.id)).toEqual(['beta', 'alpha']);
  });
});
