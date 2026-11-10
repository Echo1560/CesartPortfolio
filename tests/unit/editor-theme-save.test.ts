import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import snapshot from '../fixtures/snapshot-v3.json';

// A recording stand-in for the Supabase client: every chain ends in a row (or, for `theme`, an error).
const log: { table: string; op: string }[] = [];
let themeError: { message: string; code?: string } | null = null;

vi.mock('../../src/admin/supabase', () => ({
  explain: (e: { message?: string }) => e?.message ?? 'Unknown error',
  sb: () => ({
    from(table: string) {
      const state = { table, op: 'select' };
      const chain: any = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === 'then') {
              log.push({ table: state.table, op: state.op });
              const failed = state.table === 'theme' && themeError;
              const result = failed ? { data: null, error: themeError } : { data: [{ id: 1, updated_at: '2026-02-02T00:00:00Z' }], error: null };
              return (resolve: (v: unknown) => void) => resolve(result);
            }
            return (...args: unknown[]) => {
              if (['update', 'insert', 'upsert', 'delete'].includes(String(prop))) state.op = String(prop);
              void args;
              return chain;
            };
          },
        },
      );
      return chain;
    },
  }),
}));

const { EditorStore } = await import('../../src/admin/editor/store');
type Data = ConstructorParameters<typeof EditorStore>[0];

const make = () => {
  const data = structuredClone({
    pages: [{ id: snapshot.pages[0]!.id, slug: 'home', isHome: true, sections: snapshot.pages[0]!.sections }],
    stamps: new Map(),
    snapshot: { pages: [], theme: snapshot.theme },
    me: 'me',
    editors: new Map(),
  }) as unknown as Data;
  return new EditorStore(data, 'home');
};

const writes = () => log.filter((l) => l.op !== 'select').map((l) => l.table);

beforeEach(() => {
  log.length = 0;
  themeError = null;
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('EditorStore save ordering', () => {
  const editContent = (store: InstanceType<typeof EditorStore>) => {
    const hero = store.pages[0]!.sections[0]!;
    store.editSection(hero.id, (s) => (s.content = { ...(s.content as object), heading: [{ type: 'text', text: 'Edited' }] }), 'panel');
  };

  it('writes content first and the theme last', async () => {
    const store = make();
    editContent(store);
    store.editTheme((t) => (t.tokens.radius = 'none'));
    await store.flush();
    const tables = writes();
    expect(tables).toContain('sections');
    expect(tables.at(-1)).toBe('theme');
    expect(tables.indexOf('sections')).toBeLessThan(tables.indexOf('theme'));
    expect(store.saveState).toBe('saved');
  });

  it('still saves content when the theme write is refused, and reports the theme error', async () => {
    themeError = { message: 'theme: refused' };
    const store = make();
    editContent(store);
    store.editTheme((t) => (t.tokens.radius = 'none'));
    await store.flush();
    expect(writes()).toContain('sections');
    expect(store.saveState).toBe('error');
    expect(store.saveError).toContain('theme');
  });

  it('does not keep rewriting content that already saved when only the theme fails', async () => {
    themeError = { message: 'theme: refused' };
    const store = make();
    editContent(store);
    store.editTheme((t) => (t.tokens.radius = 'none'));
    await store.flush();
    const contentWrites = writes().filter((t) => t === 'sections').length;
    await store.flush();
    expect(writes().filter((t) => t === 'sections').length).toBe(contentWrites);
  });
});
