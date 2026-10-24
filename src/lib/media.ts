/**
 * Media resolution: turns a `Media` entry from content into what a component
 * renders (final URLs under the site base, responsive srcset, dimensions).
 *
 * Still images go through Astro's image pipeline (resized, WebP, hashed URLs).
 * Animated images and videos are copied as-is with hashed URLs, because
 * re-encoding them would drop frames or quality.
 *
 * A future backend or CDN replaces the lookups in this file; components only
 * depend on the `Resolved*` types.
 */
import type { ImageMetadata } from 'astro';
import { getImage } from 'astro:assets';
import type { Media } from './schema';

const MEDIA_PREFIX = '../../content/media/';

// Lazy globs: a file is only imported (and so only copied to dist/) when some page resolves it.

// Still images, imported as ImageMetadata so Astro can optimise them.
const imageModules = import.meta.glob<ImageMetadata>('../../content/media/**/*.{jpg,jpeg,png,avif,webp,gif,JPG,JPEG,PNG,WEBP}', {
  import: 'default',
});

// Files served untouched (animations, video). `?url` makes Vite emit them with a hashed, base-prefixed URL.
const rawModules = import.meta.glob<string>('../../content/media/**/*.{gif,webp,mp4,webm,mov,GIF,WEBP,MP4,WEBM}', {
  query: '?url',
  import: 'default',
});

/** Default responsive widths. Widths larger than the source are dropped. */
export const DEFAULT_WIDTHS = [320, 480, 640, 800, 1024, 1280, 1600, 2048];

/** Default `sizes`, matching the grid: 1 column under 600px, 2 under 1024px, 3 above. */
export const DEFAULT_SIZES = '(min-width: 1024px) 33vw, (min-width: 600px) 50vw, 100vw';

export interface ResolveOptions {
  /** `sizes` attribute for the srcset. Defaults to `DEFAULT_SIZES`. */
  sizes?: string;
  /** Candidate widths for the srcset. Defaults to `DEFAULT_WIDTHS`. */
  widths?: number[];
}

export interface ResolvedImage {
  type: 'image';
  /** Fallback URL (a mid-size rendition). */
  src: string;
  srcset: string;
  sizes: string;
  width: number;
  height: number;
  alt: string;
}

export interface ResolvedAnimated {
  type: 'animated';
  /** Original animated file (GIF or animated WebP). */
  src: string;
  width: number;
  height: number;
  alt: string;
  loop: boolean;
  /** Still frame to show first (and for reduced motion), when the content provides one. */
  poster?: ResolvedImage;
}

export interface ResolvedVideo {
  type: 'video';
  src: string;
  /** MIME type for `<source type>`. */
  mimeType: string;
  width: number;
  height: number;
  alt: string;
  loop: boolean;
  poster: ResolvedImage;
}

export interface ResolvedEmbed {
  type: 'embed';
  provider: 'youtube' | 'vimeo';
  /** Privacy-friendly player URL (youtube-nocookie / vimeo dnt). Load it only after a click. */
  embedUrl: string;
  /** Original page URL, for a fallback link. */
  pageUrl: string;
  width: number;
  height: number;
  alt: string;
  poster?: ResolvedImage;
}

export type ResolvedMedia = ResolvedImage | ResolvedAnimated | ResolvedVideo | ResolvedEmbed;

function missing(path: string): Error {
  return new Error(`Media file not found or unsupported: content/media/${path}. Run \`npm run validate:content\`.`);
}

const VIDEO_MIME: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime' };

function extension(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

/** Optimised, responsive rendition of a still image in `content/media/`. */
export async function resolveImage(path: string, alt: string, options: ResolveOptions = {}): Promise<ResolvedImage> {
  const load = imageModules[MEDIA_PREFIX + path];
  if (!load) throw missing(path);
  const meta = await load();
  const candidates = (options.widths ?? DEFAULT_WIDTHS).filter((w) => w < meta.width);
  const widths = [...candidates, meta.width];
  const image = await getImage({
    src: meta,
    widths,
    width: meta.width,
    height: meta.height,
    format: 'webp',
  });
  const sizes = options.sizes ?? DEFAULT_SIZES;
  return {
    type: 'image',
    src: image.src,
    srcset: image.srcSet.attribute,
    sizes,
    width: meta.width,
    height: meta.height,
    alt,
  };
}

async function rawUrl(path: string): Promise<string> {
  const load = rawModules[MEDIA_PREFIX + path];
  if (!load) throw missing(path);
  return load();
}

/** Parses a YouTube or Vimeo page URL into a privacy-friendly embed URL. */
export function embedUrl(provider: 'youtube' | 'vimeo', pageUrl: string): string {
  const url = new URL(pageUrl);
  if (provider === 'youtube') {
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1) : (url.searchParams.get('v') ?? url.pathname.split('/').pop() ?? '');
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`;
  }
  const id = url.pathname.split('/').filter(Boolean).pop() ?? '';
  return `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1`;
}

/** Resolves any `Media` entry. Throws if a referenced file is missing. */
export async function resolveMedia(media: Media, options: ResolveOptions = {}): Promise<ResolvedMedia> {
  const poster = media.poster ? await resolveImage(media.poster, media.alt, options) : undefined;
  switch (media.type) {
    case 'image':
      return resolveImage(media.src, media.alt, options);
    case 'animated':
      return { type: 'animated', src: await rawUrl(media.src), width: media.width, height: media.height, alt: media.alt, loop: media.loop ?? true, poster };
    case 'video':
      if (!poster) throw new Error(`Video content/media/${media.src} has no poster.`);
      return {
        type: 'video',
        src: await rawUrl(media.src),
        mimeType: VIDEO_MIME[extension(media.src)] ?? 'video/mp4',
        width: media.width,
        height: media.height,
        alt: media.alt,
        loop: media.loop ?? false,
        poster,
      };
    case 'embed':
      return {
        type: 'embed',
        provider: media.provider ?? 'youtube',
        embedUrl: embedUrl(media.provider ?? 'youtube', media.src),
        pageUrl: media.src,
        width: media.width,
        height: media.height,
        alt: media.alt,
        poster,
      };
  }
}

/** URL of a media file for meta tags (for example `og:image`), relative to the site base. */
export async function resolveMediaUrl(path: string): Promise<string> {
  const load = imageModules[MEDIA_PREFIX + path];
  if (load) {
    const meta = await load();
    const image = await getImage({ src: meta, width: Math.min(meta.width, 1200), format: 'jpg' });
    return image.src;
  }
  return rawUrl(path);
}
