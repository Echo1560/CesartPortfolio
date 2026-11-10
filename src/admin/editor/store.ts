/**
 * Draft store: all edits change this state first. It keeps undo/redo history,
 * debounced autosave to the draft tables (RLS decides who may write; the audit
 * trigger sets `updated_by`) and the current selection.
 */
import type { LooseBlock, LooseSection } from '../../components/render/types';
import { explain, sb } from '../supabase';
import { blockPayload, checkBlock, checkSection, clone, eachBlock, eachSection, sectionPayload, type EditorData, type EditorPage } from './model';

export type Device = 'desktop' | 'tablet' | 'mobile';
export type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
export type Source = 'panel' | 'inline' | 'history' | 'media' | 'load';
export interface Selection {
  sectionId: string;
  blockId?: string;
}
export type StoreEvent = { kind: 'content'; source: Source } | { kind: 'selection' } | { kind: 'page' } | { kind: 'device' } | { kind: 'save' } | { kind: 'notice' };

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
    this.lastKey = '';
    if (this.selection && !this.findSection(this.selection.sectionId)) this.selection = null;
    if (!this.page) this.pageId = pages[0]?.id ?? '';
    this.changed('history');
    this.emit({ kind: 'selection' });
  }

  private changed(source: Source): void {
    this.emit({ kind: 'content', source });
    if (this.dirtyKeys().length === 0) {
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

  private dirtyKeys(): string[] {
    const keys: string[] = [];
    for (const [key, json] of this.currentPayloads()) if (this.saved.get(key) !== json) keys.push(key);
    return keys;
  }

  /** Writes every changed section and block now. Resolves when nothing is left to save (or a save failed). */
  async flush(): Promise<void> {
    window.clearTimeout(this.timer);
    if (this.saving) {
      await this.saving;
      if (this.dirtyKeys().length === 0) return;
    }
    this.saving = this.save().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async save(): Promise<void> {
    const payloads = this.currentPayloads();
    const dirty = this.dirtyKeys().filter((k) => this.saved.has(k));
    if (dirty.length === 0) {
      this.setSave('saved');
      return;
    }
    this.setSave('saving');
    try {
      const sectionIds = dirty.filter((k) => k.startsWith('s:')).map((k) => k.slice(2));
      const blockIds = dirty.filter((k) => k.startsWith('b:')).map((k) => k.slice(2));
      await this.checkConflicts(sectionIds, blockIds);
      const c = sb();
      for (const id of sectionIds) {
        const s = this.findSection(id)!;
        checkSection(s);
        const { data, error } = await c.from('sections').update(sectionPayload(s)).eq('id', id).select('id, updated_at');
        if (error) throw new Error(explain(error));
        this.remember(id, data);
        this.saved.set(`s:${id}`, payloads.get(`s:${id}`)!);
      }
      for (const id of blockIds) {
        const found = [...eachBlock(this.pages)].find((x) => x.block.id === id)!;
        checkBlock(found.block);
        const { data, error } = await c.from('blocks').update(blockPayload(found.block)).eq('id', id).select('id, updated_at');
        if (error) throw new Error(explain(error));
        this.remember(id, data);
        this.saved.set(`b:${id}`, payloads.get(`b:${id}`)!);
      }
      if (this.dirtyKeys().length > 0) {
        this.setSave('dirty');
        this.schedule(SAVE_DELAY_MS);
      } else this.setSave('saved');
    } catch (e) {
      const message = (e as Error).message;
      this.setSave('error', message);
      // A refused value stays refused until the editor changes it; a network problem is retried.
      if (!/section:|block:/.test(message)) this.schedule(RETRY_MS);
    }
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
    this.listeners.clear();
  }
}
