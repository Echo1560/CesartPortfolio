/**
 * The editor's working model: the draft snapshot (`build_content_v3(false)`), typed loosely,
 * plus the conversions back to the rows the database stores (docs/V3-CONTRACTS.md §3, §5, §9).
 */
import { blockDraftSchema, sectionDraftSchema, type SnapshotV3, type Visibility } from '../../lib/schema-v3';
import type { Work } from '../../lib/schema';
import type { LooseBlock, LooseSection } from '../../components/render/types';
import { ok, type MediaRow } from '../data';
import { sb } from '../supabase';

export interface EditorPage {
  id: string;
  slug: string;
  title: string;
  status: 'draft' | 'published' | 'hidden';
  isHome: boolean;
  seo: Record<string, string | undefined>;
  sections: LooseSection[];
}

export interface EditorData {
  snapshot: SnapshotV3;
  pages: EditorPage[];
  works: Work[];
  media: MediaRow[];
  /** `updated_at` of every section and block as last seen, to notice another editor's changes. */
  stamps: Map<string, string>;
  editors: Map<string, string>;
  me: string;
}

export const clone = <T>(v: T): T => structuredClone(v);

/** Every media object in a JSON tree is `{mediaId, src, …}` in the snapshot and `{mediaId, …}` in a row. */
export function isResolvedMedia(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'mediaId' in v && 'src' in v;
}

/** The snapshot's resolved media back to the draft reference stored in the row. */
export function toDraftJson<T>(value: T): T {
  if (Array.isArray(value)) return value.map(toDraftJson) as T;
  if (typeof value !== 'object' || value === null) return value;
  if (isResolvedMedia(value)) {
    const m = value;
    const ref: Record<string, unknown> = { mediaId: m['mediaId'] };
    for (const key of ['posterId', 'alt', 'loop', 'focal', 'width', 'height']) if (m[key] !== undefined) ref[key] = m[key];
    return ref as T;
  }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toDraftJson(v)])) as T;
}

/** A library file as the snapshot embeds it. */
export function resolvedFromRow(row: MediaRow, previous?: { alt?: string; loop?: boolean; posterId?: string; poster?: string }): Record<string, unknown> {
  return {
    mediaId: row.id,
    type: row.kind,
    src: row.storage_path,
    alt: previous?.alt || row.default_alt || row.original_name || 'Image',
    width: row.width ?? 1,
    height: row.height ?? 1,
    ...(previous?.loop !== undefined ? { loop: previous.loop } : {}),
    ...(row.kind === 'video' && previous?.posterId ? { posterId: previous.posterId, poster: previous.poster } : {}),
  };
}

export interface SectionPayload {
  variant: string;
  settings: unknown;
  content: unknown;
  show_on_desktop: boolean;
  show_on_tablet: boolean;
  show_on_mobile: boolean;
}

const visibilityColumns = (v: Visibility) => ({ show_on_desktop: v.desktop, show_on_tablet: v.tablet, show_on_mobile: v.mobile });

export function sectionPayload(s: LooseSection): SectionPayload {
  return { variant: s.variant, settings: toDraftJson(s.settings), content: toDraftJson(s.content), ...visibilityColumns(s.visibility) };
}

export function blockPayload(b: LooseBlock) {
  return { settings: toDraftJson(b.settings), content: toDraftJson(b.content), ...visibilityColumns(b.visibility) };
}

/** The publish rules for media (alt text, video poster): the draft view refuses to load without them. */
function checkMedia(value: unknown, where: string): void {
  if (Array.isArray(value)) return value.forEach((v) => checkMedia(v, where));
  if (typeof value !== 'object' || value === null) return;
  if (isResolvedMedia(value)) {
    if (!String(value['alt'] ?? '').trim()) throw new Error(`${where}: an image needs alt text`);
    if (value['type'] === 'video' && !value['posterId']) throw new Error(`${where}: a video needs a poster image`);
    return;
  }
  Object.values(value).forEach((v) => checkMedia(v, where));
}

/** Throws a sentence for the editor when the section would be refused. */
export function checkSection(s: LooseSection): void {
  checkMedia([s.settings, s.content], `${s.type} section`);
  const r = sectionDraftSchema.safeParse({ type: s.type, variant: s.variant, settings: toDraftJson(s.settings), content: toDraftJson(s.content) });
  if (!r.success) throw new Error(`${s.type} section: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
}

export function checkBlock(b: LooseBlock): void {
  checkMedia(b.content, `${b.type} block`);
  const r = blockDraftSchema.safeParse({ type: b.type, settings: toDraftJson(b.settings), content: toDraftJson(b.content) });
  if (!r.success) throw new Error(`${b.type} block: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
}

export function* eachSection(pages: EditorPage[]): Generator<LooseSection> {
  for (const p of pages) yield* p.sections;
}

export function* eachBlock(pages: EditorPage[]): Generator<{ section: LooseSection; block: LooseBlock }> {
  for (const section of eachSection(pages)) for (const block of section.blocks ?? []) yield { section, block };
}

/** Loads the whole draft the editor needs. */
export async function loadEditorData(): Promise<EditorData> {
  const c = sb();
  const [content, media, sections, blocks, editors, session] = await Promise.all([
    c.rpc('build_content_v3', { p_published_only: false }),
    c.from('media').select('*').order('created_at', { ascending: false }),
    c.from('sections').select('id, updated_at'),
    c.from('blocks').select('id, updated_at'),
    c.from('editors').select('user_id, display_name'),
    c.auth.getSession(),
  ]);
  const snapshot = ok(content) as SnapshotV3;
  if (!snapshot || snapshot.version !== 3 || !Array.isArray(snapshot.pages)) throw new Error('The draft is not in the v3 format. Apply the v3 migrations first.');
  const stamps = new Map<string, string>();
  for (const r of [...(ok(sections) ?? []), ...(ok(blocks) ?? [])] as { id: string; updated_at: string }[]) stamps.set(r.id, r.updated_at);
  return {
    snapshot,
    pages: snapshot.pages as unknown as EditorPage[],
    works: snapshot.works,
    media: (ok(media) ?? []) as MediaRow[],
    stamps,
    editors: new Map(((ok(editors) ?? []) as { user_id: string; display_name: string }[]).map((e) => [e.user_id, e.display_name])),
    me: session.data.session?.user.id ?? '',
  };
}
