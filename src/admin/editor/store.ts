/**
 * Draft store: all edits change this state first. It keeps undo/redo history,
 * debounced autosave to the draft tables (RLS decides who may write; the audit
 * trigger sets `updated_by`) and the current selection.
 */
import type { LooseBlock, LooseSection } from '../../components/render/types';
import { explain, sb } from '../supabase';
import { copyBlock, copySection } from './defaults';
import { stepIndex } from './section-index';
import { blockPayload, checkBlock, checkSection, clone, eachBlock, eachSection, sectionPayload, type EditorData, type EditorPage } from './model';

export type Device = 'desktop' | 'tablet' | 'mobile';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type Source = 'panel' | 'inline' | 'history' | 'media' | 'load' | 'structure';
export interface Selection {
  sectionId: string;
  blockId?: string;
}
export type StoreEvent = { kind: 'content'; source: Source } | { kind: 'flash' } | { kind: 'selection' } | { kind: 'page' } | { kind: 'device' } | { kind: 'save' } | { kind: 'notice' };

const SAVE_DELAY_MS = 1200;
const RETRY_MS = 5000;
const COALESCE_MS = 1500;
const HISTORY_LIMIT = 100;

export class EditorStore {
  pages: EditorPage[];
  readonly data: EditorData;
  pageId: string;
  selection: Selection | null = null;
  device: Device = 'desktop';
  saveState: SaveState = 'saved';
  saveError = '';
  /** Set when another editor changed something since this editor loaded or last saved. */
  notice = '';
  /** A short message about the last structural change ("Section deleted"), shown with an Undo button. */
  flash = '';

  /** Ids of the sections the canvas draws on this device (set by the canvas); null = all of them. */
  drawnSectionIds: (() => string[]) | null = null;

  private flashTimer: number | undefined;
  private placed = new Map<string, string>();
  private past: EditorPage[][] = [];
  private future: EditorPage[][] = [];
  private lastKey = '';
  private lastAt = 0;
  private saved = new Map<string, string>();
  private stamps: Map<string, string>;
  private timer: number | undefined;
  private saving: Promise<void> | null = null;
  private listeners = new Set<(e: StoreEvent) => void>();

  constructor(data: EditorData, initialSlug?: string) {
    this.data = data;
    this.pages = data.pages;
    this.stamps = new Map(data.stamps);
    const start = data.pages.find((p) => p.slug === initialSlug) ?? data.pages.find((p) => p.isHome) ?? data.pages[0];
    this.pageId = start?.id ?? '';
    for (const [key, json] of this.currentPayloads()) this.saved.set(key, json);
    this.placed = this.currentPlaces();
  }

  on(fn: (e: StoreEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(e: StoreEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get page(): EditorPage | undefined {
    return this.pages.find((p) => p.id === this.pageId);
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  findSection(id: string): LooseSection | undefined {
    for (const s of eachSection(this.pages)) if (s.id === id) return s;
    return undefined;
  }
  findBlock(sectionId: string, blockId: string): LooseBlock | undefined {
    return this.findSection(sectionId)?.blocks?.find((b) => b.id === blockId);
  }

  setPage(id: string): void {
    if (id === this.pageId || !this.pages.some((p) => p.id === id)) return;
    this.pageId = id;
    this.selection = null;
    this.emit({ kind: 'page' });
    this.emit({ kind: 'selection' });
  }
  select(sel: Selection | null): void {
    if (this.selection?.sectionId === sel?.sectionId && this.selection?.blockId === sel?.blockId) return;
    this.selection = sel;
    this.emit({ kind: 'selection' });
  }
  setDevice(d: Device): void {
    this.device = d;
    this.emit({ kind: 'device' });
  }

  /**
   * Applies `fn` to a copy-on-write working state. `key` coalesces rapid edits of the same
   * thing (typing) into one undo step.
   */
  edit(fn: () => void, source: Source, key = ''): void {
    const now = Date.now();
    const coalesce = key !== '' && key === this.lastKey && now - this.lastAt < COALESCE_MS;
    if (!coalesce) {
      this.past.push(clone(this.pages));
      if (this.past.length > HISTORY_LIMIT) this.past.shift();
      this.future = [];
    }
    this.lastKey = key;
    this.lastAt = now;
    fn();
    this.changed(source);
  }

  /** Convenience: mutate one section. */
  editSection(sectionId: string, fn: (s: LooseSection) => void, source: Source, key = ''): void {
    this.edit(
      () => {
        const s = this.findSection(sectionId);
        if (s) fn(s);
      },
      source,
      key,
    );
  }

  editBlock(sectionId: string, blockId: string, fn: (b: LooseBlock) => void, source: Source, key = ''): void {
    this.edit(
      () => {
        const b = this.findBlock(sectionId, blockId);
        if (b) fn(b);
      },
      source,
      key,
    );
  }

  // ---- sections and blocks: structure ----------------------------------------

  private pageOf(sectionId: string): EditorPage | undefined {
    return this.pages.find((p) => p.sections.some((s) => s.id === sectionId));
  }

  /** Inserts `section` at `index` of the current page and selects it. */
  insertSection(index: number, section: LooseSection): void {
    const page = this.page;
    if (!page) return;
    this.edit(() => page.sections.splice(Math.max(0, Math.min(index, page.sections.length)), 0, section), 'structure');
    this.select({ sectionId: section.id });
  }

  /** Moves a section so it ends up at `index` (its position after the move). */
  moveSection(id: string, index: number): void {
    const page = this.pageOf(id);
    if (!page) return;
    const from = page.sections.findIndex((s) => s.id === id);
    const to = Math.max(0, Math.min(index, page.sections.length - 1));
    if (from < 0 || from === to) return;
    this.edit(() => {
      const [s] = page.sections.splice(from, 1);
      page.sections.splice(to, 0, s!);
    }, 'structure');
  }

  duplicateSection(id: string): void {
    const page = this.pageOf(id);
    const at = page?.sections.findIndex((s) => s.id === id) ?? -1;
    if (!page || at < 0) return;
    const copy = copySection(page.sections[at]!);
    this.edit(() => page.sections.splice(at + 1, 0, copy), 'structure');
    this.select({ sectionId: copy.id });
    this.say('Section duplicated.');
  }

  deleteSection(id: string): void {
    const page = this.pageOf(id);
    const at = page?.sections.findIndex((s) => s.id === id) ?? -1;
    if (!page || at < 0) return;
    this.edit(() => page.sections.splice(at, 1), 'structure');
    this.select(null);
    this.say('Section deleted.');
  }

  /** Adds a block to a column. `index` is the position inside that column (default: the end). */
  addBlock(sectionId: string, column: number, block: LooseBlock, index?: number): void {
    this.edit(() => {
      const s = this.findSection(sectionId);
      if (!s) return;
      this.placeBlock(s, block, column, index);
    }, 'structure');
    this.select({ sectionId, blockId: block.id });
  }

  /** Moves a block to `index` of `column` (the position after the move). */
  moveBlock(sectionId: string, blockId: string, column: number, index: number): void {
    const s = this.findSection(sectionId);
    const b = s?.blocks?.find((x) => x.id === blockId);
    if (!s || !b) return;
    this.edit(() => {
      s.blocks = s.blocks!.filter((x) => x.id !== blockId);
      this.placeBlock(s, b, column, index);
    }, 'structure');
  }

  /** Alt+Up / Alt+Down: moves the selected block (inside its column) or section one step. */
  nudgeSelection(step: -1 | 1): void {
    const sel = this.selection;
    if (!sel) return;
    if (sel.blockId) {
      const block = this.findBlock(sel.sectionId, sel.blockId);
      const inColumn = (this.findSection(sel.sectionId)?.blocks ?? []).filter((b) => b.column === block?.column);
      if (block) this.moveBlock(sel.sectionId, sel.blockId, block.column, inColumn.findIndex((b) => b.id === sel.blockId) + step);
    } else {
      const ids = this.page?.sections.map((x) => x.id) ?? [];
      // Step past the next drawn neighbour so the move is visible (same as the section toolbar buttons).
      const to = stepIndex(ids, this.drawnSectionIds?.() ?? ids, sel.sectionId, step);
      if (to !== null) this.moveSection(sel.sectionId, to);
    }
  }

  duplicateBlock(sectionId: string, blockId: string): void {
    const s = this.findSection(sectionId);
    const b = s?.blocks?.find((x) => x.id === blockId);
    if (!s || !b) return;
    const copy = copyBlock(b);
    const inColumn = (s.blocks ?? []).filter((x) => x.column === b.column);
    this.edit(() => this.placeBlock(s, copy, b.column, inColumn.findIndex((x) => x.id === blockId) + 1), 'structure');
    this.select({ sectionId, blockId: copy.id });
  }

  deleteBlock(sectionId: string, blockId: string): void {
    const s = this.findSection(sectionId);
    if (!s?.blocks?.some((x) => x.id === blockId)) return;
    this.edit(() => (s.blocks = s.blocks!.filter((x) => x.id !== blockId)), 'structure');
    this.select({ sectionId });
    this.say('Block deleted.');
  }

  /** Puts `block` in `column` at `index` among that column's blocks; the array stays grouped by column. */
  private placeBlock(s: LooseSection, block: LooseBlock, column: number, index?: number): void {
    block.column = column;
    const columns = new Map<number, LooseBlock[]>();
    for (const x of s.blocks ?? []) columns.set(x.column, [...(columns.get(x.column) ?? []), x]);
    const list = columns.get(column) ?? [];
    list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, block);
    columns.set(column, list);
    s.blocks = [...columns.entries()].sort((a, b) => a[0] - b[0]).flatMap(([, v]) => v);
  }

  /** Shows `text` next to the history buttons for a few seconds. */
  say(text: string): void {
    this.flash = text;
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.say(''), 8000);
    this.emit({ kind: 'flash' });
  }

  undo(): void {
    const prev = this.past.pop();
    if (!prev) return;
    this.future.push(clone(this.pages));
    this.replacePages(prev);
  }
  redo(): void {
    const next = this.future.pop();
    if (!next) return;
    this.past.push(clone(this.pages));
    this.replacePages(next);
  }
  private replacePages(pages: EditorPage[]): void {
    this.pages = pages;
    if (this.flash) this.say('');
    this.lastKey = '';
    if (this.selection && !this.findSection(this.selection.sectionId)) this.selection = null;
    if (!this.page) this.pageId = pages[0]?.id ?? '';
    this.changed('history');
    this.emit({ kind: 'selection' });
  }

  private changed(source: Source): void {
    this.emit({ kind: 'content', source });
    if (this.isClean()) {
      if (this.saveState !== 'saving') this.setSave('saved');
      window.clearTimeout(this.timer);
      return;
    }
    if (this.saveState !== 'saving') this.setSave('dirty');
    this.schedule(SAVE_DELAY_MS);
  }

  private schedule(ms: number): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.flush(), ms);
  }

  private setSave(state: SaveState, error = ''): void {
    this.saveState = state;
    this.saveError = error;
    this.emit({ kind: 'save' });
  }

  private currentPayloads(): Map<string, string> {
    const out = new Map<string, string>();
    for (const s of eachSection(this.pages)) out.set(`s:${s.id}`, JSON.stringify(sectionPayload(s)));
    for (const { block } of eachBlock(this.pages)) out.set(`b:${block.id}`, JSON.stringify(blockPayload(block)));
    return out;
  }

  /** Where every section and block sits (page and index, section and column and index). */
  private currentPlaces(): Map<string, string> {
    const out = new Map<string, string>();
    for (const p of this.pages) {
      p.sections.forEach((s, i) => {
        out.set(`s:${s.id}`, `${p.id}#${i}`);
        (s.blocks ?? []).forEach((b, j) => out.set(`b:${b.id}`, `${s.id}#${b.column}#${j}`));
      });
    }
    return out;
  }

  /** Rows whose content changed since the last save (new and moved rows are `structure()`). */
  private dirtyKeys(): string[] {
    const keys: string[] = [];
    for (const [key, json] of this.currentPayloads()) if (this.saved.has(key) && this.saved.get(key) !== json) keys.push(key);
    return keys;
  }

  private structure(places = this.currentPlaces()) {
    const removed = [...this.placed.keys()].filter((k) => !places.has(k));
    const added = [...places.keys()].filter((k) => !this.placed.has(k));
    const moved = [...places.keys()].filter((k) => this.placed.has(k) && this.placed.get(k) !== places.get(k));
    return { removed, added, moved };
  }

  private isClean(): boolean {
    const { removed, added, moved } = this.structure();
    return this.dirtyKeys().length === 0 && removed.length + added.length + moved.length === 0;
  }

  /** Writes every changed section and block now. Resolves when nothing is left to save (or a save failed). */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.saving) {
      await this.saving;
      if (this.isClean()) return;
    }
    this.saving = this.save().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async save(): Promise<void> {
    if (this.isClean()) {
      this.setSave('saved');
      return;
    }
    this.setSave('saving');
    try {
      await this.sync();
      if (!this.isClean()) {
        this.setSave('dirty');
        this.schedule(SAVE_DELAY_MS);
      } else this.setSave('saved');
    } catch (e) {
      const message = (e as Error).message;
      this.setSave('error', message);
      // A refused value stays refused until the editor changes it; a network problem is retried.
      if (!/section:|block:|Not saved/.test(message)) this.schedule(RETRY_MS);
    }
  }

  /**
   * Order matters. Deletes first. Then section rows (positions), then settings that do not lower a
   * column count, then blocks (a block may sit in a column the section only just gained), then the
   * settings that lower a column count (the blocks left those columns already), then block content.
   * Positions of a page are written in one request: the unique constraints are checked at commit.
   */
  private async sync(): Promise<void> {
    const c = sb();
    const payloads = this.currentPayloads();
    const places = this.currentPlaces();
    const { removed, added, moved } = this.structure(places);
    const dirty = this.dirtyKeys();
    const goneSections = new Set(removed.filter((k) => k.startsWith('s:')).map((k) => k.slice(2)));
    const sectionOf = (place: string) => place.split('#')[0]!;
    const sectionDirty = dirty.filter((k) => k.startsWith('s:')).map((k) => k.slice(2));
    const blockDirty = dirty.filter((k) => k.startsWith('b:')).map((k) => k.slice(2));
    await this.checkConflicts(sectionDirty, blockDirty);

    // 1. deletes (a deleted section takes its blocks with it)
    const delBlocks = removed.filter((k) => k.startsWith('b:') && !goneSections.has(sectionOf(this.placed.get(k)!))).map((k) => k.slice(2));
    if (delBlocks.length) await this.write(c.from('blocks').delete().in('id', delBlocks).select('id'));
    if (goneSections.size) await this.write(c.from('sections').delete().in('id', [...goneSections]).select('id'));
    for (const k of removed) this.forget(k);

    // 2. section rows of every page that gained, lost or moved a section
    const touched = [...added, ...moved];
    const pagesTouched = new Set<string>();
    for (const k of touched) if (k.startsWith('s:')) pagesTouched.add(sectionOf(places.get(k)!));
    for (const pid of [...pagesTouched]) {
      const page = this.pages.find((p) => p.id === pid);
      if (!page || page.sections.length === 0) continue;
      const rows = page.sections.map((s, i) => {
        checkSection(s);
        const known = this.saved.get(`s:${s.id}`);
        const body = known ? (JSON.parse(known) as Record<string, unknown>) : (sectionPayload(s) as unknown as Record<string, unknown>);
        return { id: s.id, page_id: page.id, type: s.type, position: i, ...body };
      });
      await this.write(c.from('sections').upsert(rows, { onConflict: 'id' }).select('id, updated_at'));
      for (const s of page.sections) {
        const key = `s:${s.id}`;
        if (!this.saved.has(key)) this.saved.set(key, payloads.get(key)!);
        this.placed.set(key, places.get(key)!);
      }
    }
    // A page that only lost sections needs its positions closed up too.
    // (Gaps are allowed by the contract, so nothing to write.)

    // 3. content of sections, except those that lower their column count
    const columns = (p: { settings?: { columns?: number } } | undefined) => p?.settings?.columns ?? 2;
    const lowers = (id: string) => {
      const s = this.findSection(id);
      return s?.type === 'columns' && columns(JSON.parse(this.saved.get(`s:${id}`)!)) > columns(sectionPayload(s) as never);
    };
    const patchSection = async (id: string) => {
      const s = this.findSection(id);
      if (!s) return;
      checkSection(s);
      const rows = await this.write(c.from('sections').update(sectionPayload(s)).eq('id', id).select('id, updated_at'));
      if (!rows.length) throw new Error('Not saved: you can no longer edit this item');
      this.remember(id, rows);
      this.saved.set(`s:${id}`, payloads.get(`s:${id}`)!);
    };
    for (const id of sectionDirty.filter((i) => this.saved.has(`s:${i}`) && !lowers(i))) await patchSection(id);

    // 4. blocks of every section that gained, lost or moved a block, plus blocks of new sections
    const sectionsTouched = new Set<string>();
    for (const k of touched) if (k.startsWith('b:')) sectionsTouched.add(sectionOf(places.get(k)!));
    for (const k of added) if (k.startsWith('s:')) sectionsTouched.add(k.slice(2));
    for (const sid of sectionsTouched) {
      const s = this.findSection(sid);
      if (!s?.blocks?.length) continue;
      const rows = s.blocks.map((b, j) => {
        checkBlock(b);
        return { id: b.id, section_id: sid, type: b.type, column_index: b.column, position: j, ...blockPayload(b) };
      });
      await this.write(c.from('blocks').upsert(rows, { onConflict: 'id' }).select('id, updated_at'));
      for (const b of s.blocks) {
        const key = `b:${b.id}`;
        this.saved.set(key, payloads.get(key)!);
        this.placed.set(key, places.get(key)!);
      }
    }

    // 5. the settings that lower a column count, then block content
    for (const id of sectionDirty.filter((i) => lowers(i))) await patchSection(id);
    for (const id of blockDirty) {
      const found = [...eachBlock(this.pages)].find((x) => x.block.id === id);
      if (!found || this.saved.get(`b:${id}`) === payloads.get(`b:${id}`)) continue;
      checkBlock(found.block);
      const rows = await this.write(c.from('blocks').update(blockPayload(found.block)).eq('id', id).select('id, updated_at'));
      if (!rows.length) throw new Error('Not saved: you can no longer edit this item');
      this.remember(id, rows);
      this.saved.set(`b:${id}`, payloads.get(`b:${id}`)!);
    }
  }

  private forget(key: string): void {
    this.saved.delete(key);
    this.placed.delete(key);
    this.stamps.delete(key.slice(2));
  }

  /** Runs one request; its error becomes a sentence, its rows are returned. */
  private async write(q: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<unknown[]> {
    const { data, error } = await q;
    if (error) throw new Error(explain(error as never));
    return Array.isArray(data) ? data : [];
  }

  private remember(id: string, rows: unknown): void {
    const row = Array.isArray(rows) ? (rows[0] as { updated_at?: string } | undefined) : undefined;
    if (row?.updated_at) this.stamps.set(id, row.updated_at);
  }

  /** Last write wins, but tell the editor when someone else changed what they are about to overwrite. */
  private async checkConflicts(sectionIds: string[], blockIds: string[]): Promise<void> {
    const c = sb();
    const rows: { id: string; updated_at: string; updated_by: string | null }[] = [];
    if (sectionIds.length) rows.push(...(((await c.from('sections').select('id, updated_at, updated_by').in('id', sectionIds)).data ?? []) as typeof rows));
    if (blockIds.length) rows.push(...(((await c.from('blocks').select('id, updated_at, updated_by').in('id', blockIds)).data ?? []) as typeof rows));
    const others = new Set<string>();
    for (const r of rows) {
      const known = this.stamps.get(r.id);
      if (known && r.updated_at && r.updated_at !== known) {
        if (r.updated_by && r.updated_by !== this.data.me) others.add(this.data.editors.get(r.updated_by) ?? 'Another editor');
        this.stamps.set(r.id, r.updated_at);
      }
    }
    if (others.size > 0) {
      this.notice = `${[...others].join(', ')} changed this page since you opened it. Your edits replaced theirs (the last save wins). Reload to see their version.`;
      this.emit({ kind: 'notice' });
    }
  }

  dismissNotice(): void {
    this.notice = '';
    this.emit({ kind: 'notice' });
  }

  destroy(): void {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.flashTimer);
    this.listeners.clear();
  }
}
