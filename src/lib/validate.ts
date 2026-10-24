/**
 * Whole-content validation: shape (zod) plus the cross-file rules zod cannot
 * see on its own. Pure: the caller says which media files exist, so the same
 * code runs in the Astro build, in `npm run validate:content` and in tests.
 */
import type { z } from 'zod';
import { siteSchema, worksSchema, type Media, type Site, type Work } from './schema';

export interface ValidContent {
  site: Site;
  works: Work[];
}

export class ContentError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(
      `Invalid content (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nFix the files in content/ and run `npm run validate:content`.',
    );
    this.name = 'ContentError';
    this.problems = problems;
  }
}

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((acc, key) => (typeof key === 'number' ? `${acc}[${key}]` : acc ? `${acc}.${String(key)}` : String(key)), '');
}

function zodProblems(file: string, error: z.ZodError, describe?: (path: PropertyKey[]) => string): string[] {
  return error.issues.map((issue) => {
    const where = describe?.(issue.path) ?? formatPath(issue.path);
    return `${file}${where ? ` → ${where}` : ''}: ${issue.message}`;
  });
}

function duplicates(values: string[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const v of values) (seen.has(v) ? dupes : seen).add(v);
  return [...dupes];
}

/**
 * Validates raw parsed JSON. Throws `ContentError` listing every problem found,
 * not just the first one.
 *
 * @param mediaExists returns true when `content/media/<path>` is a file.
 */
export function validateContent(siteRaw: unknown, worksRaw: unknown, mediaExists: (path: string) => boolean): ValidContent {
  const problems: string[] = [];

  const siteResult = siteSchema.safeParse(siteRaw);
  if (!siteResult.success) problems.push(...zodProblems('site.json', siteResult.error));

  // Name works by id/slug in messages so authors can find the entry quickly.
  const rawList = Array.isArray(worksRaw) ? worksRaw : [];
  const describeWork = (path: PropertyKey[]) => {
    const [index, ...rest] = path;
    if (typeof index !== 'number') return formatPath(path);
    const entry = rawList[index] as { id?: unknown } | undefined;
    const label = typeof entry?.id === 'string' ? `work "${entry.id}"` : `work #${index + 1}`;
    return rest.length ? `${label} → ${formatPath(rest)}` : label;
  };
  const worksResult = worksSchema.safeParse(worksRaw);
  if (!worksResult.success) problems.push(...zodProblems('works.json', worksResult.error, describeWork));

  if (!siteResult.success || !worksResult.success) throw new ContentError(problems);

  const site = siteResult.data;
  const works = worksResult.data;

  for (const id of duplicates(site.categories.map((c) => c.id))) problems.push(`site.json → categories: duplicate id "${id}"`);
  for (const slug of duplicates(site.categories.map((c) => c.slug))) problems.push(`site.json → categories: duplicate slug "${slug}"`);
  for (const id of duplicates(site.contact.socials.map((s) => s.id))) problems.push(`site.json → contact.socials: duplicate id "${id}"`);
  for (const id of duplicates(site.layout.sections.map((s) => s.id))) problems.push(`site.json → layout.sections: section "${id}" appears more than once`);
  for (const id of duplicates(works.map((w) => w.id))) problems.push(`works.json: duplicate id "${id}"`);
  for (const slug of duplicates(works.map((w) => w.slug))) problems.push(`works.json: duplicate slug "${slug}"`);

  const categoryIds = new Set(site.categories.map((c) => c.id));
  const workIds = new Set(works.map((w) => w.id));

  for (const work of works) {
    if (!categoryIds.has(work.categoryId)) {
      problems.push(`works.json → work "${work.id}": unknown categoryId "${work.categoryId}" (known: ${[...categoryIds].join(', ')})`);
    }
  }

  for (const section of site.layout.sections) {
    if (section.id !== 'featured') continue;
    for (const id of section.options?.workIds ?? []) {
      if (!workIds.has(id)) problems.push(`site.json → layout.sections.featured: workIds lists unknown work "${id}"`);
    }
  }

  const checkFile = (where: string, path: string) => {
    if (!mediaExists(path)) problems.push(`${where}: media file not found: content/media/${path}`);
  };
  const checkMedia = (where: string, media: Media) => {
    if (media.type !== 'embed') checkFile(`${where}.src`, media.src);
    if (media.poster) checkFile(`${where}.poster`, media.poster);
  };

  checkFile('site.json → meta.ogImage', site.meta.ogImage);
  checkMedia('site.json → hero.media', site.hero.media);
  if (site.about.portrait) checkMedia('site.json → about.portrait', site.about.portrait);
  for (const work of works) {
    checkMedia(`works.json → work "${work.id}" → media`, work.media);
    work.gallery?.forEach((m, i) => checkMedia(`works.json → work "${work.id}" → gallery[${i}]`, m));
  }

  if (problems.length) throw new ContentError(problems);
  return { site, works };
}
