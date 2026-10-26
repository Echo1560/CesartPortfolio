import { describe, expect, it } from 'vitest';
import { compareWorks, getCategories, getFeaturedWorks, getLayout, getSite, getWork, getWorks, renderMarkdown } from './content';
import type { Work } from './schema';
import { track } from './track';

const work = (over: Partial<Work>): Work => ({
  id: 'a',
  slug: 'a',
  title: 'A',
  categoryId: 'illustration',
  tags: [],
  description: '',
  media: { type: 'image', src: 'a.jpg', alt: 'a', width: 1, height: 1 },
  ...over,
});

describe('compareWorks', () => {
  it('sorts by order, then year descending, then title', () => {
    const list = [
      work({ id: 'no-order-old', year: 2020, title: 'B' }),
      work({ id: 'no-order-new', year: 2024, title: 'C' }),
      work({ id: 'second', order: 2 }),
      work({ id: 'first', order: 1, year: 2000 }),
      work({ id: 'no-year', title: 'A' }),
    ];
    expect(list.sort(compareWorks).map((w) => w.id)).toEqual(['first', 'second', 'no-order-new', 'no-order-old', 'no-year']);
  });
});

describe('data-access layer', () => {
  it('returns site, layout and categories', async () => {
    const site = await getSite();
    expect(site.meta.lang).toBe('en');
    expect(await getLayout()).toBe(site.layout);
    expect((await getCategories()).length).toBe(2);
  });

  it('filters works by category and featured flag', async () => {
    const all = await getWorks();
    const animation = await getWorks({ categoryId: 'animation' });
    const featured = await getWorks({ featured: true });
    expect(animation.length).toBeGreaterThan(0);
    expect(animation.every((w) => w.categoryId === 'animation')).toBe(true);
    expect(featured.every((w) => w.featured)).toBe(true);
    expect(all.length).toBe(animation.length + (await getWorks({ categoryId: 'illustration' })).length);
    expect([...all].sort(compareWorks)).toEqual(all);
  });

  it('finds a work by slug', async () => {
    expect((await getWork('placeholder-animation-02'))?.media.type).toBe('video');
    expect(await getWork('does-not-exist')).toBeUndefined();
  });

  it('returns featured works in configured order', async () => {
    const layout = await getLayout();
    const section = layout.sections.find((s) => s.id === 'featured');
    const ids = section?.id === 'featured' ? (section.options?.workIds ?? []) : [];
    expect((await getFeaturedWorks()).map((w) => w.id)).toEqual(ids);
  });

  it('renders markdown', () => {
    expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    const md = ['## Hi', '- a\n- b', '> quote', '`code`'].join('\n\n');
    expect(renderMarkdown(md)).toBe(
      '<h2>Hi</h2>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n<blockquote>\n<p>quote</p>\n</blockquote>\n<p><code>code</code></p>\n',
    );
    expect(renderMarkdown('[site](https://example.com "T") [mail](mailto:a@example.com)')).toBe(
      '<p><a href="https://example.com" title="T">site</a> <a href="mailto:a@example.com">mail</a></p>\n',
    );
  });

  it('sanitizes markdown from editors (stored XSS)', () => {
    const html = renderMarkdown(
      [
        'Hi <script>alert(1)</script>',
        '<img src=x onerror="alert(2)">',
        '[click](javascript:alert(3))',
        '<a href="JaVaScRiPt:alert(4)">x</a> <a href="//evil.example/">y</a>',
        '<p onclick="alert(5)" style="color:red">p</p><iframe src="https://evil.example"></iframe>',
        '<svg onload="alert(6)"></svg>',
      ].join('\n\n'),
    );
    expect(html).not.toMatch(/<script|onerror|onclick|onload|javascript:|<img|<iframe|<svg|style=|evil\.example/i);
    expect(html).toContain('<p>p</p>');
    expect(html).toContain('Hi');
  });
});

describe('track', () => {
  it('is a no-op that returns nothing', () => {
    expect(track('page_view', { path: '/' })).toBeUndefined();
  });
});
