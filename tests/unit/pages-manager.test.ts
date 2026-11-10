import { beforeEach, describe, expect, it, vi } from 'vitest';

type Call = { table: string; op: string; arg?: unknown };
const calls: Call[] = [];
let failOn: (c: Call) => boolean = () => false;
let selectRows: Record<string, unknown[]> = {};

function from(table: string) {
  const q: any = {
    _op: 'select',
    insert(arg: unknown) { q._op = 'insert'; q._arg = arg; return q; },
    update(arg: unknown) { q._op = 'update'; q._arg = arg; return q; },
    delete() { q._op = 'delete'; return q; },
    select() { return q; },
    eq() { return q; },
    order() { return q; },
    limit() { return q; },
    then(resolve: (v: unknown) => void) {
      const c: Call = { table, op: q._op, arg: q._arg };
      calls.push(c);
      resolve(failOn(c) ? { data: null, error: { message: 'boom' } } : { data: q._op === 'select' ? selectRows[table] ?? [] : [{ id: 1 }], error: null });
    },
  };
  return q;
}
vi.mock('../../src/admin/supabase', async (orig) => ({ ...(await orig<object>()), sb: () => ({ from }) }));

const { addNavItem, deletePage, duplicatePage, suggestSlug } = await import('../../src/admin/views/pages');

const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const KEEP = ID(1), GONE = ID(2), NEW = ID(3);
const pageLink = (id: string) => ({ kind: 'page' as const, pageId: id });
const mkState = () => ({
  pages: [],
  media: [],
  email: '',
  nav: { items: [{ id: 'a', label: 'Keep', link: pageLink(KEEP) }, { id: 'b', label: 'Gone', link: pageLink(GONE) }] },
  footer: { showSocials: false, showCopyright: false, showBackToTop: false, links: [{ label: 'Gone', link: pageLink(GONE) }] },
}) as any;

beforeEach(() => {
  calls.length = 0;
  failOn = () => false;
  selectRows = {};
});

describe('suggestSlug', () => {
  it('kebab-cases a title', () => expect(suggestSlug('My New Page', [])).toBe('my-new-page'));
  it('avoids reserved bases', () => expect(suggestSlug('Admin', [])).toMatch(/^admin-page$/));
  it('avoids collisions', () => expect(suggestSlug('About', ['about', 'about-2'])).toBe('about-3'));
  it('truncates without a trailing dash', () => {
    const slug = suggestSlug(`${'a'.repeat(89)} b`, []);
    expect(slug).toBe('a'.repeat(89));
    expect(slug.endsWith('-')).toBe(false);
  });
});

describe('addNavItem', () => {
  const item = { id: 'n', label: 'New', link: pageLink(NEW) };
  it('updates state after a successful save', async () => {
    const state = mkState();
    await addNavItem(state, item);
    expect(state.nav.items).toHaveLength(3);
  });
  it('leaves state untouched when the save fails', async () => {
    const state = mkState();
    failOn = (c) => c.table === 'site';
    await expect(addNavItem(state, item)).rejects.toThrow();
    expect(state.nav.items).toHaveLength(2);
  });
});

describe('deletePage', () => {
  it('deletes the page before touching nav and footer', async () => {
    const state = mkState();
    await deletePage(state, GONE);
    expect(calls.map((c) => `${c.table}:${c.op}`)).toEqual(['pages:delete', 'site:update', 'site:update']);
    expect(state.nav.items.map((i: any) => i.id)).toEqual(['a']);
    expect(state.footer.links).toEqual([]);
  });
  it('keeps the links when the page delete fails', async () => {
    const state = mkState();
    failOn = (c) => c.table === 'pages';
    await expect(deletePage(state, GONE)).rejects.toThrow();
    expect(calls.some((c) => c.table === 'site')).toBe(false);
    expect(state.nav.items).toHaveLength(2);
    expect(state.footer.links).toHaveLength(1);
  });
});

describe('duplicatePage', () => {
  const page = { id: 'p', slug: 'about', title: 'About', seo_title: null, seo_description: null, social_media_id: null, status: 'published', is_home: false, position: 0, sections: [] } as any;
  beforeEach(() => {
    selectRows = { sections: [{ type: 'text', variant: 'a', position: 0, settings: {}, content: {}, show_on_desktop: true, show_on_tablet: true, show_on_mobile: true, blocks: [] }], pages: [{ position: 3 }] };
  });
  it('deletes the new draft when copying sections fails', async () => {
    failOn = (c) => c.table === 'sections' && c.op === 'insert';
    await expect(duplicatePage(page, ['about'])).rejects.toThrow('boom');
    const last = calls[calls.length - 1]!;
    expect(`${last.table}:${last.op}`).toBe('pages:delete');
  });
  it('does not roll back on success', async () => {
    await duplicatePage(page, ['about']);
    expect(calls.some((c) => c.op === 'delete')).toBe(false);
  });
});
