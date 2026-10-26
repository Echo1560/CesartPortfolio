/**
 * Naming rules for the build-time variants of animated media (docs/V2-CONTRACTS.md
 * §4, "Media variants"). Shared by the generator (`scripts/lib/variants.ts`) and
 * the resolver (`media.ts`). Pure: no fs, no Astro.
 *
 * Variants live in `generated/media/` (git-ignored), next to a copy of the
 * source key: `placeholder/loop.gif` → `placeholder/loop.gif.webm`,
 * `placeholder/loop.gif.mp4`, `placeholder/loop.gif.poster.jpg`.
 */
import type { Media } from './schema';

/** Folder for generated variants, relative to the project root. */
export const VARIANTS_DIR = 'generated/media';

/** Source formats that get video variants. GIF, plus animated WebP. */
const ANIMATED_EXTENSIONS = new Set(['gif', 'webp']);

export interface VariantKeys {
  webm: string;
  mp4: string;
  poster: string;
}

export interface VideoSource {
  src: string;
  mimeType: 'video/webm' | 'video/mp4';
}

/** True for `animated` media whose file is a GIF or WebP. */
export function hasVariants(media: Pick<Media, 'type' | 'src'>): boolean {
  if (media.type !== 'animated') return false;
  return ANIMATED_EXTENSIONS.has(media.src.split('.').pop()?.toLowerCase() ?? '');
}

/** Variant paths for a source key, relative to `VARIANTS_DIR`. */
export function variantKeys(src: string): VariantKeys {
  return { webm: `${src}.webm`, mp4: `${src}.mp4`, poster: `${src}.poster.jpg` };
}

/**
 * `<source>` list for an animated file: WebM first, then MP4. Each entry is
 * included only when `urlFor` finds the generated file, so a missing variant
 * (no ffmpeg, a frame the encoder rejected) leaves `[]` and the GIF fallback.
 */
export async function videoSources(src: string, urlFor: (key: string) => Promise<string | undefined>): Promise<VideoSource[]> {
  const keys = variantKeys(src);
  const [webm, mp4] = await Promise.all([urlFor(keys.webm), urlFor(keys.mp4)]);
  const sources: VideoSource[] = [];
  if (webm) sources.push({ src: webm, mimeType: 'video/webm' });
  if (mp4) sources.push({ src: mp4, mimeType: 'video/mp4' });
  return sources;
}
