/**
 * Runs before `astro build` (`npm run build`). Gets the content and its media
 * ready on disk, then generates the video variants of animated media.
 *
 *   CONTENT_SOURCE=local     validate content/*.json, content/snapshot-v3.json
 *                            and content/media/
 *   CONTENT_SOURCE=supabase  fetch the live snapshot (v3) with the anon key,
 *                            download every Storage object it references (works,
 *                            section/block media, background images, videos,
 *                            posters, social images) into content/media/,
 *                            validate, and write the snapshot to
 *                            generated/content.json for `astro build`
 *                            (docs/V2-CONTRACTS.md §4 and §8, V3-CONTRACTS.md §5)
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
import type { SnapshotV3 } from '../src/lib/schema-v3.ts';
import { ContentError, validateContent, type ValidContent } from '../src/lib/validate.ts';
import { snapshotAnimatedKeys, snapshotMediaKeys, validateSnapshotV3 } from '../src/lib/validate-v3.ts';
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

interface Loaded {
  content: ValidContent;
  snapshot: SnapshotV3;
}

/** The v3 part of a published snapshot, as `{version, site, theme, pages, works}`. */
function v3Input(input: ContentInput): unknown {
  if (input.version !== 3) {
    throw new ContentSourceError('The published snapshot is not version 3 (no pages or theme). Publish again from the editor, or run the v3 migrations first.');
  }
  return { version: input.version, site: input.site, theme: input.theme, pages: input.pages, works: input.works };
}

async function loadContent(): Promise<Loaded> {
  // Never leave a previous snapshot behind: a failed or local run must not let astro build render stale content.
  await removeSnapshot(root);
  const source = contentSource();
  if (source === 'local') {
    const { site, works } = readLocal();
    return { content: validateContent(site, works, mediaExists), snapshot: validateSnapshotV3(readLocalSnapshot(), mediaExists) };
  }

  const config = supabaseConfig();
  console.log(`→ content: published snapshot from ${config.url}`);
  const input = await fetchPublishedContent(config);
  // Shape first (files not checked yet), so bad content fails before any download.
  const shaped = validateContent(input.site, input.works, () => true);
  const shapedV3 = validateSnapshotV3(v3Input(input), () => true);
  const keys = [...new Set([...mediaKeys(shaped), ...snapshotMediaKeys(shapedV3)])].sort();
  const { written, unchanged } = await downloadMedia(config, keys, mediaDir);
  console.log(`→ media: ${keys.length} files from Storage (${written.length} written, ${unchanged.length} unchanged)`);
  const content = validateContent(input.site, input.works, mediaExists);
  const snapshot = validateSnapshotV3(v3Input(input), mediaExists);
  await writeSnapshot(root, config, input);
  return { content, snapshot };
}

function readLocalSnapshot(): unknown {
  try {
    return JSON.parse(readFileSync(join(contentDir, 'snapshot-v3.json'), 'utf8')) as unknown;
  } catch (error) {
    throw new ContentSourceError(`content/snapshot-v3.json could not be read as JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Source keys of every animated GIF/WebP: v2 site media, works, and the media of v3 sections and blocks. */
function animatedKeys({ site, works }: ValidContent, snapshot: SnapshotV3): string[] {
  const v2: (Media | undefined)[] = [site.hero.media, site.about.portrait, ...works.flatMap((w) => [w.media, ...(w.gallery ?? [])])];
  const keys = v2.filter((m): m is Media => m !== undefined && hasVariants(m)).map((m) => m.src);
  return [...new Set([...keys, ...snapshotAnimatedKeys(snapshot)])].sort();
}

async function buildVariants({ content, snapshot }: Loaded): Promise<void> {
  // Start clean so variants of removed media never ship. Regenerating from the cache is a file copy.
  await rm(variantsDir, { recursive: true, force: true });
  const mode = (process.env.MEDIA_VARIANTS ?? '').trim() || (process.env.CI ? 'required' : 'auto');
  if (!['auto', 'required', 'off'].includes(mode)) throw new ContentSourceError(`MEDIA_VARIANTS must be auto, required or off, got "${mode}".`);
  const keys = animatedKeys(content, snapshot);
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
  const loaded = await loadContent();
  await buildVariants(loaded);
  const { content, snapshot } = loaded;
  const placeholders = content.works.filter((w) => w.placeholder).length;
  console.log(
    `✓ content is valid: ${content.works.length} works, ${content.site.categories.length} categories` +
      (placeholders ? ` (${placeholders} marked placeholder)` : '') +
      `, ${snapshot.pages.length} page${snapshot.pages.length === 1 ? '' : 's'}`,
  );
} catch (error) {
  if (error instanceof ContentError || error instanceof ContentSourceError || (error instanceof Error && error.name === 'VariantError')) {
    console.error(`✗ ${error.name}: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
