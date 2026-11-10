import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/admin/editor/store';
import type { EditorData } from '../../src/admin/editor/model';
import { DEFAULT_THEME_TOKENS } from '../../src/lib/schema-v3';

const make = () => {
  const theme = { preset: 'classic', tokens: structuredClone(DEFAULT_THEME_TOKENS) };
  const data = { pages: [{ id: 'p', slug: 'home', isHome: true, sections: [] }], stamps: new Map(), snapshot: { pages: [], theme } } as unknown as EditorData;
  return new EditorStore(data, 'home');
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// `isClean` is private; it shows as saveState 'saved' (clean) versus 'dirty'.
describe('EditorStore theme editing', () => {
  it('editTheme changes the draft theme, marks the store dirty and announces a theme change', () => {
    const store = make();
    const sources: string[] = [];
    store.on((e) => e.kind === 'content' && sources.push(e.source));
    store.editTheme((t) => (t.tokens.colors.light.accent = '#7a2e8e'));
    expect(store.theme.tokens.colors.light.accent).toBe('#7a2e8e');
    expect(store.saveState).toBe('dirty');
    expect(sources).toEqual(['theme']);
  });

  it('is clean again when an edit is reverted to the saved value', () => {
    const store = make();
    const original = store.theme.tokens.colors.light.accent;
    store.editTheme((t) => (t.tokens.colors.light.accent = '#7a2e8e'));
    store.editTheme((t) => (t.tokens.colors.light.accent = original));
    expect(store.saveState).toBe('saved');
  });

  it('undoTheme restores the previous theme and returns to clean', () => {
    const store = make();
    store.editTheme((t) => (t.tokens.typography.headingFont = 'lora'));
    expect(store.canUndoTheme).toBe(true);
    store.undoTheme();
    expect(store.theme.tokens.typography.headingFont).toBe(DEFAULT_THEME_TOKENS.typography.headingFont);
    expect(store.canUndoTheme).toBe(false);
    expect(store.saveState).toBe('saved');
  });

  it('undoTheme with nothing to undo does nothing', () => {
    const store = make();
    expect(() => store.undoTheme()).not.toThrow();
    expect(store.saveState).toBe('saved');
  });

  it('rapid edits with the same key make one undo step; a different key starts a new one', () => {
    const store = make();
    store.editTheme((t) => (t.tokens.colors.light.accent = '#111111'), 'light:accent');
    store.editTheme((t) => (t.tokens.colors.light.accent = '#222222'), 'light:accent');
    store.editTheme((t) => (t.tokens.radius = 'none'), 'radius');
    store.undoTheme();
    expect(store.theme.tokens.radius).toBe(DEFAULT_THEME_TOKENS.radius);
    expect(store.theme.tokens.colors.light.accent).toBe('#222222');
    store.undoTheme();
    expect(store.theme.tokens.colors.light.accent).toBe(DEFAULT_THEME_TOKENS.colors.light.accent);
    expect(store.canUndoTheme).toBe(false);
  });

  it('the same key after the coalescing window starts a new undo step', () => {
    const store = make();
    store.editTheme((t) => (t.tokens.colors.light.accent = '#111111'), 'k');
    vi.setSystemTime(Date.now() + 5000);
    store.editTheme((t) => (t.tokens.colors.light.accent = '#222222'), 'k');
    store.undoTheme();
    expect(store.theme.tokens.colors.light.accent).toBe('#111111');
  });

  it('an unkeyed edit never coalesces', () => {
    const store = make();
    store.editTheme((t) => (t.tokens.radius = 'none'));
    store.editTheme((t) => (t.tokens.radius = 'large'));
    store.undoTheme();
    expect(store.theme.tokens.radius).toBe('none');
  });
});
