/**
 * Runs before `astro build` (`npm run build`). Gets the content and its media
 * ready on disk, then generates the video variants of animated media.
 *
 *   CONTENT_SOURCE=local     validate content/*.json + content/media/ (v1)
 *   CONTENT_SOURCE=supabase  fetch the live snapshot with the anon key, download
 *                            every referenced Storage object into content/media/,
 *                            validate, and write the snapshot to
 *                            generated/content.json for `astro build`
 *                            (docs/V2-CONTRACTS.md §4 and §8)
 *
 * Media must be on disk before Astro starts: `media.ts` finds files with
 * `import.meta.glob`, which is resolved when the bundle is built. Public pages
 * then serve every file from GitHub Pages, never from Supabase.
 *
 * Variants: ffmpeg comes from `ffmpeg-static` or PATH. Without it the build
 * warns and renders the original GIF, unless MEDIA_VARIANTS=required (or CI is
 * set), in which case it fails. MEDIA_VARIANTS=off skips them.
 *
 * Exits 1 with a clear message on any failure. Never falls back to local content.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ContentSourceError,
  contentSource,
  downloadMedia,
  fetchPublishedContent,
  mediaDir as mediaDirOf,
  mediaKeys,
  removeSnapshot,
  supabaseConfig,
  writeSnapshot,
  type ContentInput,
} from '../src/lib/content-source.ts';
import { hasVariants, VARIANTS_DIR } from '../src/lib/media-variants.ts';
import type { Media } from '../src/lib/schema.ts';
import { ContentError, validateContent, type ValidContent } from '../src/lib/validate.ts';
import { findFfmpeg, generateVariants } from './lib/variants.ts';

const root = process.cwd();
const contentDir = join(root, 'content');
const mediaDir = mediaDirOf(root);
const variantsDir = join(root, VARIANTS_DIR);
const cacheDir = join(root, 'node_modules', '.cache', 'cesart-media-variants');

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));

const mediaExists = (path: string) => {
  const full = join(mediaDir, path);
  return existsSync(full) && statSync(full).isFile();
};

function readLocal(): ContentInput {
  const read = (file: string) => {
    try {
      return JSON.parse(readFileSync(join(contentDir, file), 'utf8')) as unknown;
    } catch (error) {
      throw new ContentSourceError(`content/${file} could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return { site: read('site.json'), works: read('works.json') };
}

async function loadContent(): Promise<ValidContent> {
  // Never leave a previous snapshot behind: a failed or local run must not let astro build render stale content.
  await removeSnapshot(root);
  const source = contentSource();
  if (source === 'local') {
    const { site, works } = readLocal();
    return validateContent(site, works, mediaExists);
  }

  const config = supabaseConfig();
  console.log(`→ content: published snapshot from ${config.url}`);
  const input = await fetchPublishedContent(config);
  // Shape first (files not checked yet), so bad content fails before any download.
  const shaped = validateContent(input.site, input.works, () => true);
  const keys = mediaKeys(shaped);
  const { written, unchanged } = await downloadMedia(config, keys, mediaDir);
  console.log(`→ media: ${keys.length} files from Storage (${written.length} written, ${unchanged.length} unchanged)`);
  const valid = validateContent(input.site, input.works, mediaExists);
  await writeSnapshot(root, config, input);
  return valid;
}

function animatedKeys({ site, works }: ValidContent): string[] {
  const all: (Media | undefined)[] = [site.hero.media, site.about.portrait, ...works.flatMap((w) => [w.media, ...(w.gallery ?? [])])];
  return [...new Set(all.filter((m): m is Media => m !== undefined && hasVariants(m)).map((m) => m.src))].sort();
}

async function buildVariants(content: ValidContent): Promise<void> {
  // Start clean so variants of removed media never ship. Regenerating from the cache is a file copy.
  await rm(variantsDir, { recursive: true, force: true });
  const mode = (process.env.MEDIA_VARIANTS ?? '').trim() || (process.env.CI ? 'required' : 'auto');
  if (!['auto', 'required', 'off'].includes(mode)) throw new ContentSourceError(`MEDIA_VARIANTS must be auto, required or off, got "${mode}".`);
  const keys = animatedKeys(content);
  if (mode === 'off' || keys.length === 0) {
    console.log(`→ variants: ${mode === 'off' ? 'skipped (MEDIA_VARIANTS=off)' : 'no animated GIF/WebP media'}`);
    return;
  }
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    const message = 'ffmpeg not found (install dev dependencies or put ffmpeg on PATH)';
    if (mode === 'required') throw new ContentSourceError(`${message}; MEDIA_VARIANTS=required.`);
    console.warn(`⚠ variants: ${message}. Animated media will use the original files only.`);
    return;
  }
  let cached = 0;
  for (const key of keys) {
    const result = await generateVariants(mediaDir, key, variantsDir, { ffmpeg, cacheDir });
    if (result.cached) cached++;
  }
  console.log(`→ variants: ${keys.length} animated files → WebM + MP4 + poster (${cached} from cache)`);
}

try {
  const content = await loadContent();
  await buildVariants(content);
  const placeholders = content.works.filter((w) => w.placeholder).length;
  console.log(
    `✓ content is valid: ${content.works.length} works, ${content.site.categories.length} categories` +
      (placeholders ? ` (${placeholders} marked placeholder)` : ''),
  );
} catch (error) {
  if (error instanceof ContentError || error instanceof ContentSourceError || (error instanceof Error && error.name === 'VariantError')) {
    console.error(`✗ ${error.name}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
