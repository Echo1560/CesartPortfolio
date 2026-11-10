/**
 * Validation of a v3 publish snapshot (docs/V3-CONTRACTS.md §5): shape (zod) plus
 * the checks zod cannot do, like "every media file exists". Pure: the caller
 * says which files exist, so the Astro build, scripts and tests share it.
 *
 * References the database does not check (nav links to missing pages, unknown
 * `workIds`) are NOT errors: the renderer skips them (contract §5).
 */
import type { z } from 'zod';
import { ContentError } from './validate';
import { snapshotV3Schema, type SnapshotSection, type SnapshotV3, type Visibility } from './schema-v3';
import type { Media } from './schema';
import { hasVariants } from './media-variants';

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), '');
}

function problemsOf(error: z.ZodError): string[] {
  return error.issues.map((i) => `snapshot → ${formatPath(i.path)}: ${i.message}`);
}

type MediaLike = Pick<Media, 'type' | 'src' | 'poster'>;

/** Every `media`/`portrait`/`backgroundImage.image` of a section or block `content`/`settings` object, found by shape. */
function mediaIn(value: unknown, out: MediaLike[]): void {
  if (Array.isArray(value)) return value.forEach((v) => mediaIn(v, out));
  if (typeof value !== 'object' || value === null) return;
  const o = value as Record<string, unknown>;
  if (typeof o.src === 'string' && typeof o.type === 'string' && 'mediaId' in o) out.push(o as unknown as MediaLike);
  else Object.values(o).forEach((v) => mediaIn(v, out));
}

/** All media of the sections and blocks of one page. */
export function sectionMedia(sections: SnapshotSection[]): MediaLike[] {
  const found: MediaLike[] = [];
  for (const s of sections) {
    mediaIn(s.settings, found);
    mediaIn(s.content, found);
    for (const b of (s as { blocks?: { content: unknown }[] }).blocks ?? []) mediaIn(b.content, found);
  }
  return found;
}

/** Bucket keys a snapshot references, sorted and unique (media `src`, posters, social images). */
export function snapshotMediaKeys(snapshot: SnapshotV3): string[] {
  const keys = new Set<string>([snapshot.site.meta.ogImage]);
  const add = (m: MediaLike | undefined) => {
    if (!m) return;
    if (m.type !== 'embed') keys.add(m.src);
    if (m.poster) keys.add(m.poster);
  };
  for (const p of snapshot.pages) {
    if (p.seo.ogImage) keys.add(p.seo.ogImage);
    sectionMedia(p.sections).forEach(add);
  }
  for (const w of snapshot.works) {
    add(w.media);
    w.gallery?.forEach(add);
  }
  return [...keys].sort();
}

interface Shown {
  visibility: Visibility;
  blocks?: { visibility: Visibility }[];
}
const shownSomewhere = (item: Shown) => item.visibility.desktop || item.visibility.tablet || item.visibility.mobile;

/**
 * The snapshot without the sections and blocks hidden on every device. Publish
 * keeps them (with their `visibility`) so restoring a version brings them back;
 * the build never renders them or needs their media (contract §5, `snapshot_strip_hidden()` in SQL).
 */
export function withoutHidden(snapshot: SnapshotV3): SnapshotV3 {
  return {
    ...snapshot,
    pages: snapshot.pages.map((p) => ({
      ...p,
      sections: p.sections
        .filter((s) => shownSomewhere(s as unknown as Shown))
        .map((s): SnapshotSection => {
          const blocks = (s as unknown as Shown).blocks;
          return blocks ? ({ ...s, blocks: blocks.filter(shownSomewhere) } as SnapshotSection) : s;
        }),
    })),
  };
}

/** Source keys of the animated GIF/WebP media in a snapshot (works and every section/block), which get video variants. */
export function snapshotAnimatedKeys(snapshot: SnapshotV3): string[] {
  const all: MediaLike[] = [...snapshot.pages.flatMap((p) => sectionMedia(p.sections))];
  for (const w of snapshot.works) all.push(w.media, ...(w.gallery ?? []));
  return [...new Set(all.filter((m) => hasVariants(m)).map((m) => m.src))].sort();
}

/** Throws `ContentError` listing every problem. Returns the snapshot as the build renders it (`withoutHidden`). */
export function validateSnapshotV3(raw: unknown, mediaExists: (path: string) => boolean): SnapshotV3 {
  const result = snapshotV3Schema.safeParse(raw);
  if (!result.success) throw new ContentError(problemsOf(result.error));
  const snapshot = withoutHidden(result.data);
  const problems: string[] = [];

  const dupes = (values: string[]) => values.filter((v, i) => values.indexOf(v) !== i);
  for (const id of new Set(dupes(snapshot.works.map((w) => w.id)))) problems.push(`snapshot → works: duplicate id "${id}"`);
  for (const slug of new Set(dupes(snapshot.works.map((w) => w.slug)))) problems.push(`snapshot → works: duplicate slug "${slug}"`);
  for (const id of new Set(dupes(snapshot.pages.map((p) => p.id)))) problems.push(`snapshot → pages: duplicate id "${id}"`);

  for (const key of snapshotMediaKeys(snapshot)) {
    if (!mediaExists(key)) problems.push(`snapshot: media file not found: content/media/${key}`);
  }
  if (problems.length) throw new ContentError(problems);
  return snapshot;
}
