/**
 * Data-access layer. The ONLY module that reads content, from `content/*.json`
 * or from Supabase.
 *
 * Components and pages call these functions and never import the JSON files
 * directly. `load()` picks the source from `CONTENT_SOURCE` (docs/V2-CONTRACTS.md
 * §8); the function signatures and the returned types are the same for both.
 *
 *   local (default)  content/*.json + content/media/
 *   supabase         the live publish snapshot, fetched with the anon key. Media
 *                    must already be in content/media/: `npm run build` runs
 *                    scripts/prepare-content.ts first, which downloads it.
 *
 * Runs at build time only (Astro frontmatter, `getStaticPaths`). Do not import
 * it from client-side scripts.
 */
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { marked } from 'marked';
import siteJson from '../../content/site.json';
import worksJson from '../../content/works.json';
import { contentSource, fetchPublishedContent, supabaseConfig } from './content-source';
import type { Category, Layout, Site, Work } from './schema';
import { validateContent, type ValidContent } from './validate';

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

let cache: Promise<ValidContent> | undefined;

async function fromSource(): Promise<ValidContent> {
  if (contentSource() === 'local') return validateContent(siteJson, worksJson, mediaExists);
  const { site, works } = await fetchPublishedContent(supabaseConfig());
  return validateContent(site, works, mediaExists);
}

/**
 * Loads and validates all content once per build. Throws `ContentError` on
 * invalid content and `ContentSourceError` when Supabase cannot be read.
 */
function load(): Promise<ValidContent> {
  cache ??= fromSource();
  return cache;
}

/** Sort by `order` ascending (missing last), then `year` descending (missing last), then title. */
export function compareWorks(a: Work, b: Work): number {
  const orderA = a.order ?? Number.POSITIVE_INFINITY;
  const orderB = b.order ?? Number.POSITIVE_INFINITY;
  if (orderA !== orderB) return orderA < orderB ? -1 : 1;
  const yearA = a.year ?? Number.NEGATIVE_INFINITY;
  const yearB = b.year ?? Number.NEGATIVE_INFINITY;
  if (yearA !== yearB) return yearA > yearB ? -1 : 1;
  return a.title.localeCompare(b.title);
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

/** Renders a Markdown string from content (for example `about.body`) to HTML. Content is trusted (authored in the repo). */
export function renderMarkdown(markdown: string): string {
  return marked.parse(markdown, { async: false });
}
