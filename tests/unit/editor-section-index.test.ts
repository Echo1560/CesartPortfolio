import { describe, expect, it, vi } from 'vitest';
import { EditorStore } from '../../src/admin/editor/store';
import type { EditorData } from '../../src/admin/editor/model';
import { insertIndex, stepIndex } from '../../src/admin/editor/section-index';

// "b" is not drawn on this device.
const ids = ['a', 'b', 'c', 'd'];
const drawn = ['a', 'c', 'd'];

describe('insertIndex', () => {
  it('maps the drawn index to the index in page.sections', () => {
    expect(insertIndex(ids, drawn, 0)).toBe(0);
    expect(insertIndex(ids, drawn, 1)).toBe(2);
    expect(insertIndex(ids, drawn, 2)).toBe(3);
  });
  it('appends at the end, and into an empty page', () => {
    expect(insertIndex(ids, drawn, drawn.length)).toBe(4);
    expect(insertIndex([], [], 0)).toBe(0);
  });
  it('puts the end of a page ending in an undrawn section after it', () => {
    expect(insertIndex(['a', 'b'], ['a'], 1)).toBe(2);
  });
});

describe('stepIndex', () => {
  it('steps past an undrawn neighbour to the next drawn one', () => {
    expect(stepIndex(ids, drawn, 'c', -1)).toBe(0);
    expect(stepIndex(ids, drawn, 'a', 1)).toBe(2);
  });
  it('moves by one when the neighbour is drawn', () => {
    expect(stepIndex(ids, drawn, 'c', 1)).toBe(3);
    expect(stepIndex(ids, drawn, 'd', -1)).toBe(2);
  });
  it('is null when no drawn neighbour lies that way', () => {
    expect(stepIndex(ids, drawn, 'a', -1)).toBeNull();
    expect(stepIndex(ids, drawn, 'd', 1)).toBeNull();
    expect(stepIndex(['a', 'b'], ['a'], 'a', 1)).toBeNull();
    expect(stepIndex(ids, drawn, 'zz', 1)).toBeNull();
  });
});

describe('EditorStore.nudgeSelection (sections)', () => {
  const make = (drawn: string[] | null) => {
    vi.stubGlobal('window', globalThis);
    const sections = ['a', 'b', 'c', 'd'].map((id) => ({ id, type: 'cta', variant: 'default', settings: {}, content: {}, blocks: [], visibility: { desktop: true, tablet: true, mobile: true } }));
    const data = { pages: [{ id: 'p', slug: 'home', isHome: true, sections }], stamps: new Map(), snapshot: { pages: [] } } as unknown as EditorData;
    const store = new EditorStore(data, 'home');
    store.drawnSectionIds = drawn && (() => drawn);
    const order = () => store.page!.sections.map((s) => s.id).join('');
    return { store, order };
  };

  it('steps past an undrawn neighbour so the change is visible', () => {
    const { store, order } = make(['a', 'c', 'd']);
    store.select({ sectionId: 'a' });
    store.nudgeSelection(1);
    expect(order()).toBe('bcad');
    store.nudgeSelection(-1);
    expect(order()).toBe('bacd');
  });

  it('does nothing when no drawn neighbour lies in that direction', () => {
    const { store, order } = make(['c', 'd']);
    store.select({ sectionId: 'c' });
    store.nudgeSelection(-1);
    expect(order()).toBe('abcd');
    store.select({ sectionId: 'd' });
    store.nudgeSelection(1);
    expect(order()).toBe('abcd');
  });

  it('moves by one when every section is drawn', () => {
    const { store, order } = make(null);
    store.select({ sectionId: 'b' });
    store.nudgeSelection(1);
    expect(order()).toBe('acbd');
  });
});
