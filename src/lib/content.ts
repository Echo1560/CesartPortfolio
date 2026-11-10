/**
 * Data-access layer. The ONLY module that reads content, from `content/*.json`
 * or from Supabase.
 *
 * Components and pages call these functions and never import the JSON files
 * directly. `load()` picks the source from `CONTENT_SOURCE` (docs/V2-CONTRACTS.md
 * §8); the function signatures and the returned types are the same for both.
 *
 *   local (default)  content/*.json + content/media/
 *   supabase         the live publish snapshot. `npm run build` runs
 *                    scripts/prepare-content.ts first, which fetches it with
 *                    the anon key, downloads its media into content/media/,
 *                    validates it and writes it to generated/content.json.
 *                    This module reads that file, so the build renders exactly
 *                    the snapshot whose media was downloaded.
 *
 * Runs at build time only (Astro frontmatter, `getStaticPaths`). Do not import
 * it from client-side scripts.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import siteJson from '../../content/site.json';
import worksJson from '../../content/works.json';
import { compareWorks } from './render-model';
import { ContentSourceError, contentSource, readSnapshot, supabaseConfig } from './content-source';
import type { Category, Layout, Site, Work } from './schema';
import type { SnapshotV3 } from './schema-v3';
import { validateContent, type ValidContent } from './validate';
import { validateSnapshotV3 } from './validate-v3';

export type { Category, FeaturedOptions, GridOptions, Layout, Media, Section, SectionId, Site, Social, Work } from './schema';
export { ContentError } from './validate';
export { ContentSourceError } from './content-source';

export interface WorkFilter {
  categoryId?: string;
  featured?: boolean;
}

const MEDIA_DIR = join(process.cwd(), 'content', 'media');

function mediaExists(path: string): boolean {
  const full = join(MEDIA_DIR, path);
  return existsSync(full) && statSync(full).isFile();
}

/** v3 snapshot of the local source: the migrated v2 content (docs/V3-CONTRACTS.md §7), editable by hand. */
export const LOCAL_SNAPSHOT_FILE = join(process.cwd(), 'content', 'snapshot-v3.json');

let cache: Promise<ValidContent> | undefined;
let snapshotCache: Promise<SnapshotV3> | undefined;

async function fromSource(): Promise<ValidContent> {
  if (contentSource() === 'local') return validateContent(siteJson, worksJson, mediaExists);
  const { site, works } = await readSnapshot(process.cwd(), supabaseConfig());
  return validateContent(site, works, mediaExists);
}

/**
 * Loads and validates all content once per build. Throws `ContentError` on
 * invalid content and `ContentSourceError` when the Supabase snapshot was not prepared.
 */
function load(): Promise<ValidContent> {
  cache ??= fromSource();
  return cache;
}

export { compareWorks };

async function snapshotFromSource(): Promise<SnapshotV3> {
  if (contentSource() === 'local') {
    return validateSnapshotV3(JSON.parse(readFileSync(LOCAL_SNAPSHOT_FILE, 'utf8')), mediaExists);
  }
  const { site, works, version, pages, theme } = await readSnapshot(process.cwd(), supabaseConfig());
  if (version !== 3) {
    throw new ContentSourceError('The published snapshot is not version 3 (no pages or theme). Publish again from the v3 editor, or run the v3 migrations first.');
  }
  return validateSnapshotV3({ version, site, theme, pages, works }, mediaExists);
}

/**
 * The v3 snapshot: site (nav, footer, SEO defaults), theme, published pages with
 * their sections and blocks, and works. This is what the renderer reads
 * (docs/V3-CONTRACTS.md §5). Loaded and validated once per build.
 */
export function getSnapshot(): Promise<SnapshotV3> {
  snapshotCache ??= snapshotFromSource();
  return snapshotCache;
}

export async function getSite(): Promise<Site> {
  return (await load()).site;
}

export async function getLayout(): Promise<Layout> {
  return (await load()).site.layout;
}

export async function getCategories(): Promise<Category[]> {
  return (await load()).site.categories;
}

/** Works sorted by `order`, then `year` descending. Optionally filtered. */
export async function getWorks(filter: WorkFilter = {}): Promise<Work[]> {
  const { works } = await load();
  return works
    .filter((w) => filter.categoryId === undefined || w.categoryId === filter.categoryId)
    .filter((w) => filter.featured === undefined || Boolean(w.featured) === filter.featured)
    .sort(compareWorks);
}

export async function getWork(slug: string): Promise<Work | undefined> {
  return (await load()).works.find((w) => w.slug === slug);
}

/**
 * Works for the featured section, in the order given by
 * `layout.sections[featured].options.workIds`, capped by `limit`. Falls back to
 * works flagged `featured: true` when no ids are configured.
 */
export async function getFeaturedWorks(): Promise<Work[]> {
  const { site, works } = await load();
  const section = site.layout.sections.find((s) => s.id === 'featured');
  const options = section?.id === 'featured' ? section.options : undefined;
  const ids = options?.workIds ?? [];
  const picked = ids.length
    ? ids.map((id) => works.find((w) => w.id === id)).filter((w): w is Work => w !== undefined)
    : works.filter((w) => w.featured).sort(compareWorks);
  return options?.limit ? picked.slice(0, options.limit) : picked;
}

/**
 * Allowlist for Markdown output. Content is NOT trusted: with
 * CONTENT_SOURCE=supabase any editor writes it, and the public site shares an
 * origin with /admin/. Scripts, event handlers, styles, images and
 * non-http(s)/mailto links are removed.
 */
const MARKDOWN_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre'],
  allowedAttributes: { a: ['href', 'title', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
};

/** Renders a Markdown string from content (for example `about.body`) to sanitized HTML. */
export function renderMarkdown(markdown: string): string {
  return sanitizeHtml(marked.parse(markdown, { async: false }), MARKDOWN_SANITIZE);
}
