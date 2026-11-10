/**
 * What every shared component needs to render a page: the snapshot data and a
 * media lookup. The public build fills it at build time; the editor fills it
 * with draft data (stage 3). Components never read content themselves.
 */
import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { Category, Media, Work } from '../../lib/schema';
import type { ResolvedMedia } from '../../lib/media';
import type { SnapshotPage, SnapshotSite } from '../../lib/schema-v3';
import { resolveLink, type ResolvedLink, type SiteLookup } from '../../lib/render-model';

/** The fields of a `Media` entry that identify a file. */
export type MediaLike = Pick<Media, 'type' | 'src' | 'poster' | 'loop'>;

/** Key under which a resolved media entry is stored. */
export function mediaKey(m: MediaLike): string {
  return [m.type, m.src, m.poster ?? '', m.loop ? 'loop' : ''].join('|');
}

export interface RenderContext extends SiteLookup {
  site: SnapshotSite;
  categories: Category[];
  /** The page being rendered. Undefined for work pages. */
  page?: SnapshotPage;
  /** Media already resolved to final URLs (`lib/render-media.ts`, or signed URLs in the editor). */
  media: ReadonlyMap<string, ResolvedMedia>;
  works: Work[];
}

export const RenderCtx = createContext<RenderContext | undefined>(undefined);

export function useRender(): RenderContext {
  const ctx = useContext(RenderCtx);
  if (!ctx) throw new Error('Section components must render inside <RenderCtx.Provider>.');
  return ctx;
}

/** Hook: resolve a `Link` for the current page. */
export function useLink(): (link: Parameters<typeof resolveLink>[0]) => ResolvedLink | undefined {
  const ctx = useRender();
  return (link) => resolveLink(link, ctx, ctx.page?.id);
}
