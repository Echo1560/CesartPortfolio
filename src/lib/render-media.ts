/**
 * Build-time media resolution for the shared renderer. Components are
 * synchronous, so everything a page shows is resolved up front into a map the
 * render context carries. `media.ts` stays the only place media URLs are built.
 *
 * The editor builds the same map from signed Storage URLs instead.
 */
import { mediaKey, type MediaLike } from '../components/render/context';
import { resolveMedia, type ResolvedMedia } from './media';
import type { Media } from './schema';
import type { SnapshotPage } from './schema-v3';
import { sectionsOf } from '../components/render/types';
import { sectionMedia } from './validate-v3';
import type { Work } from './schema';

const cache = new Map<string, Promise<ResolvedMedia>>();

/** Resolves one entry, once per build. `sizes` is only an attribute, so components override it per use. */
function resolveOnce(media: Media): Promise<ResolvedMedia> {
  const key = mediaKey(media);
  let found = cache.get(key);
  if (!found) {
    found = resolveMedia(media);
    cache.set(key, found);
  }
  return found;
}

async function resolveAll(list: MediaLike[]): Promise<Map<string, ResolvedMedia>> {
  const unique = new Map<string, Media>();
  for (const m of list) unique.set(mediaKey(m), m as Media);
  const entries = await Promise.all([...unique].map(async ([key, m]) => [key, await resolveOnce(m)] as const));
  return new Map(entries);
}

function workMedia(works: Work[]): MediaLike[] {
  return works.flatMap((w) => [w.media, ...(w.gallery ?? [])]);
}

/** Section types whose pages render work tiles and the lightbox. */
const NEEDS_WORKS = new Set(['gallery', 'featured', 'works-list']);

/** Media for a page: its sections' media, plus every work's media when a section shows works. */
export async function resolvePageMedia(page: SnapshotPage, works: Work[]): Promise<Map<string, ResolvedMedia>> {
  const list = sectionMedia(page.sections) as MediaLike[];
  if (sectionsOf(page).some((s) => NEEDS_WORKS.has(s.type))) list.push(...workMedia(works));
  return resolveAll(list);
}

/** Media for work detail pages. */
export function resolveWorkMedia(work: Work): Promise<Map<string, ResolvedMedia>> {
  return resolveAll(workMedia([work]));
}
