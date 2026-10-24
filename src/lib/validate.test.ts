import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContentError, validateContent } from './validate';

const site = JSON.parse(readFileSync('content/site.json', 'utf8'));
const works = JSON.parse(readFileSync('content/works.json', 'utf8'));
const allFiles = () => true;
const clone = <T>(v: T): T => structuredClone(v);

function problemsFor(siteRaw: unknown, worksRaw: unknown, exists: (p: string) => boolean = allFiles): string[] {
  try {
    validateContent(siteRaw, worksRaw, exists);
    return [];
  } catch (error) {
    if (error instanceof ContentError) return error.problems;
    throw error;
  }
}

describe('validateContent', () => {
  it('accepts the committed content', () => {
    const { site: s, works: w } = validateContent(site, works, allFiles);
    expect(w.length).toBeGreaterThanOrEqual(8);
    expect(s.categories.map((c) => c.id)).toEqual(['illustration', 'animation']);
  });

  it('rejects missing alt text', () => {
    const w = clone(works);
    w[0].media.alt = '  ';
    expect(problemsFor(site, w).join('\n')).toMatch(/work "placeholder-illustration-01" → media\.alt: alt text is required/);
  });

  it('rejects duplicate ids and slugs', () => {
    const w = clone(works);
    w[1].id = w[0].id;
    w[2].slug = w[0].slug;
    const problems = problemsFor(site, w).join('\n');
    expect(problems).toMatch(/duplicate id "placeholder-illustration-01"/);
    expect(problems).toMatch(/duplicate slug "placeholder-illustration-01"/);
  });

  it('rejects an unknown categoryId', () => {
    const w = clone(works);
    w[0].categoryId = 'sculpture';
    expect(problemsFor(site, w).join('\n')).toMatch(/unknown categoryId "sculpture"/);
  });

  it('rejects a video without a poster', () => {
    const w = clone(works);
    const video = w.find((x: { media: { type: string } }) => x.media.type === 'video');
    delete video.media.poster;
    expect(problemsFor(site, w).join('\n')).toMatch(/media\.poster: video needs a poster image/);
  });

  it('rejects missing media files and names the path', () => {
    const problems = problemsFor(site, works, (p) => p !== 'placeholder/illustration-03.jpg');
    expect(problems).toEqual(['works.json → work "placeholder-illustration-03" → media.src: media file not found: content/media/placeholder/illustration-03.jpg']);
  });

  it('rejects unknown featured work ids', () => {
    const s = clone(site);
    s.layout.sections.find((x: { id: string }) => x.id === 'featured').options.workIds.push('nope');
    expect(problemsFor(s, works).join('\n')).toMatch(/workIds lists unknown work "nope"/);
  });

  it('rejects non-kebab-case ids and absolute media paths', () => {
    const w = clone(works);
    w[0].id = 'Not Kebab';
    w[1].media.src = '/etc/passwd';
    const problems = problemsFor(site, w).join('\n');
    expect(problems).toMatch(/must be kebab-case/);
    expect(problems).toMatch(/must be a path relative to content\/media\//);
  });

  it('rejects an unknown layout section', () => {
    const s = clone(site);
    s.layout.sections.push({ id: 'blog', visible: true });
    expect(problemsFor(s, works).length).toBeGreaterThan(0);
  });

  it('reports every problem at once', () => {
    const w = clone(works);
    w[0].categoryId = 'x';
    w[1].categoryId = 'y';
    expect(problemsFor(site, w)).toHaveLength(2);
  });
});
