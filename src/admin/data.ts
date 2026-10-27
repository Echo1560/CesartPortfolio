/** Draft data access. Everything here talks to the draft tables; publishing is a separate step. */
import type { Media } from '../lib/schema';
import { explain, sb } from './supabase';

export interface Stamped {
  updated_at: string;
  updated_by: string | null;
}
export interface SiteRow extends Stamped {
  id: 1;
  placeholder: boolean;
  meta_title: string;
  meta_description: string;
  meta_author: string;
  meta_lang: string;
  og_media_id: string;
  hero_heading: string;
  hero_subheading: string;
  about_heading: string;
  about_body: string;
  contact_heading: string;
  contact_email: string;
  contact_cta_label: string;
}
export interface SocialRow extends Stamped {
  id: string;
  label: string;
  url: string;
  position: number;
}
export interface CategoryRow extends Stamped {
  id: string;
  slug: string;
  label: string;
  position: number;
}
export interface WorkRow extends Stamped {
  id: string;
  slug: string;
  title: string;
  year: number | null;
  category_id: string;
  tags: string[];
  description: string;
  featured: boolean;
  sort_order: number | null;
  placeholder: boolean;
  status: 'draft' | 'published' | 'archived';
}
export type MediaKind = 'image' | 'animated' | 'video';
export interface MediaRow extends Stamped {
  id: string;
  storage_path: string;
  kind: MediaKind;
  mime_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
  default_alt: string;
  original_name: string | null;
}
export type Slot = 'hero' | 'about_portrait' | 'work_cover' | 'work_gallery';
export interface PlacementRow extends Stamped {
  id: string;
  slot: Slot;
  work_id: string | null;
  position: number;
  type: 'image' | 'animated' | 'video' | 'embed';
  media_id: string | null;
  poster_media_id: string | null;
  embed_url: string | null;
  provider: 'youtube' | 'vimeo' | null;
  alt: string;
  width: number | null;
  height: number | null;
  loop: boolean | null;
}
export interface LayoutRow extends Stamped {
  section_id: 'hero' | 'featured' | 'grid' | 'about' | 'contact';
  position: number;
  visible: boolean;
  options: Record<string, unknown>;
}
export interface FeaturedRow extends Stamped {
  work_id: string;
  position: number;
}
export interface EditorRow {
  user_id: string;
  display_name: string;
  email: string;
}

export interface Draft {
  site: SiteRow;
  socials: SocialRow[];
  categories: CategoryRow[];
  works: WorkRow[];
  media: MediaRow[];
  placements: PlacementRow[];
  layout: LayoutRow[];
  featured: FeaturedRow[];
  editors: Map<string, EditorRow>;
}

/** Throws a readable Error when a query failed. */
export function ok<T>(res: { data: T | null; error: { message?: string; code?: string } | null }): T {
  if (res.error) throw new Error(explain(res.error));
  return res.data as T;
}

export async function loadDraft(): Promise<Draft> {
  const c = sb();
  const [site, socials, categories, works, media, placements, layout, featured, editors] = await Promise.all([
    c.from('site').select('*').eq('id', 1).single(),
    c.from('socials').select('*').order('position'),
    c.from('categories').select('*').order('position'),
    c.from('works').select('*'),
    c.from('media').select('*').order('created_at', { ascending: false }),
    c.from('media_placements').select('*').order('position'),
    c.from('layout').select('*').order('position'),
    c.from('layout_featured_works').select('*').order('position'),
    c.from('editors').select('user_id, display_name, email'),
  ]);
  return {
    site: ok(site) as SiteRow,
    socials: ok(socials) as SocialRow[],
    categories: ok(categories) as CategoryRow[],
    works: sortWorks(ok(works) as WorkRow[]),
    media: ok(media) as MediaRow[],
    placements: ok(placements) as PlacementRow[],
    layout: ok(layout) as LayoutRow[],
    featured: ok(featured) as FeaturedRow[],
    editors: new Map((ok(editors) as EditorRow[]).map((e) => [e.user_id, e])),
  };
}

/** Same order as the published site: `order` ascending (missing last), then year descending, then title. */
export function sortWorks(works: WorkRow[]): WorkRow[] {
  return [...works].sort((a, b) => {
    const ao = a.sort_order ?? Number.POSITIVE_INFINITY;
    const bo = b.sort_order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao < bo ? -1 : 1;
    if ((b.year ?? 0) !== (a.year ?? 0)) return (b.year ?? 0) - (a.year ?? 0);
    return a.title.localeCompare(b.title);
  });
}

export function stampText(row: Stamped, draft: Draft): string {
  const who = row.updated_by ? (draft.editors.get(row.updated_by)?.display_name ?? 'an editor') : 'unknown';
  return `Last edited by ${who}, ${new Date(row.updated_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

// ---------------------------------------------------------------------------
// Placements <-> Content `Media`
// ---------------------------------------------------------------------------

/** What the media form edits. Mirrors a `media_placements` row without ids. */
export interface PlacementValue {
  type: PlacementRow['type'];
  mediaId: string | null;
  posterId: string | null;
  embedUrl: string;
  provider: 'youtube' | 'vimeo' | '';
  alt: string;
  width: number | null;
  height: number | null;
  loop: boolean;
}

export function placementToValue(p: PlacementRow | undefined): PlacementValue {
  return {
    type: p?.type ?? 'image',
    mediaId: p?.media_id ?? null,
    posterId: p?.poster_media_id ?? null,
    embedUrl: p?.embed_url ?? '',
    provider: p?.provider ?? '',
    alt: p?.alt ?? '',
    width: p?.width ?? null,
    height: p?.height ?? null,
    loop: p?.loop ?? true,
  };
}

/** Builds the Content `Media` object the zod schema validates (same mapping as `build_content`). */
export function valueToMedia(v: PlacementValue, media: MediaRow[]): Partial<Media> {
  const byId = new Map(media.map((m) => [m.id, m]));
  const file = v.mediaId ? byId.get(v.mediaId) : undefined;
  const poster = v.posterId ? byId.get(v.posterId) : undefined;
  const out: Partial<Media> = {
    type: v.type,
    src: v.type === 'embed' ? v.embedUrl : (file?.storage_path ?? ''),
    alt: v.alt,
    width: v.width ?? file?.width ?? undefined,
    height: v.height ?? file?.height ?? undefined,
  };
  if (poster) out.poster = poster.storage_path;
  if (v.type === 'embed' && v.provider) out.provider = v.provider;
  if ((v.type === 'animated' || v.type === 'video') && !v.loop) out.loop = false;
  return out;
}

export function placementRowFields(v: PlacementValue) {
  const embed = v.type === 'embed';
  return {
    type: v.type,
    media_id: embed ? null : v.mediaId,
    poster_media_id: v.type === 'video' || embed ? v.posterId : null,
    embed_url: embed ? v.embedUrl : null,
    provider: embed ? v.provider || null : null,
    alt: v.alt.trim(),
    width: embed ? v.width : null,
    height: embed ? v.height : null,
    loop: v.type === 'animated' || v.type === 'video' ? v.loop : null,
  };
}

/** Insert or update the single placement of a slot (hero, about portrait, work cover). */
export async function saveSinglePlacement(slot: Exclude<Slot, 'work_gallery'>, workId: string | null, existing: PlacementRow | undefined, v: PlacementValue): Promise<void> {
  const fields = placementRowFields(v);
  if (existing) ok(await sb().from('media_placements').update(fields).eq('id', existing.id).select('id'));
  else ok(await sb().from('media_placements').insert({ slot, work_id: workId, position: 0, ...fields }).select('id'));
}

export async function removePlacement(id: string): Promise<void> {
  ok(await sb().from('media_placements').delete().eq('id', id).select('id'));
}

const GALLERY_OFFSET = 1000;

/** Replaces a work's gallery. Positions are unique per work, so rows are rewritten rather than swapped. */
export async function saveGallery(workId: string, values: PlacementValue[]): Promise<void> {
  const old = ok(await sb().from('media_placements').select('id').eq('work_id', workId).eq('slot', 'work_gallery')) as { id: string }[];
  // Insert the new rows at offset positions first: if that fails, the old gallery is untouched.
  const rows = values.map((v, i) => ({ slot: 'work_gallery' as const, work_id: workId, position: GALLERY_OFFSET + i, ...placementRowFields(v) }));
  const created = rows.length ? (ok(await sb().from('media_placements').insert(rows).select('id, position')) as { id: string; position: number }[]) : [];
  if (old.length) ok(await sb().from('media_placements').delete().in('id', old.map((o) => o.id)).select('id'));
  for (const c of created) ok(await sb().from('media_placements').update({ position: c.position - GALLERY_OFFSET }).eq('id', c.id).select('id'));
}

// ---------------------------------------------------------------------------
// Private bucket URLs
// ---------------------------------------------------------------------------

const urlCache = new Map<string, { url: string; expires: number }>();
const TTL = 3600;

/** Signed URLs for draft media. The bucket is private, so every preview goes through RLS. */
export async function signedUrls(paths: string[]): Promise<Map<string, string>> {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => (urlCache.get(p)?.expires ?? 0) <= now);
  if (need.length > 0) {
    const { data, error } = await sb().storage.from('media').createSignedUrls(need, TTL);
    if (error) throw new Error(explain(error));
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) urlCache.set(item.path, { url: item.signedUrl, expires: now + (TTL - 120) * 1000 });
    }
  }
  const out = new Map<string, string>();
  for (const p of paths) {
    const hit = urlCache.get(p);
    if (hit) out.set(p, hit.url);
  }
  return out;
}

export function forgetUrl(path: string): void {
  urlCache.delete(path);
}
