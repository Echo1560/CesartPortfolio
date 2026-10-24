import { describe, expect, it } from 'vitest';
import { ContentError, validateContent } from '../../src/lib/validate';
import siteFixture from '../fixtures/site.json';
import worksFixture from '../fixtures/works.json';

const clone = <T>(v: T): T => structuredClone(v);
const allFiles = () => true;

function problemsFor(site: unknown, works: unknown, exists: (p: string) => boolean = allFiles): string {
  try {
    validateContent(site, works, exists);
  } catch (error) {
    if (error instanceof ContentError) return error.problems.join('\n');
    throw error;
  }
  return '';
}

describe('validateContent', () => {
  it('accepts the fixture content', () => {
    expect(problemsFor(siteFixture, worksFixture)).toBe('');
  });

  it('rejects missing alt text', () => {
    const works = clone(worksFixture) as any[];
    delete works[0].media.alt;
    expect(problemsFor(siteFixture, works)).toMatch(/work "alpha".*alt/);
  });

  it('rejects blank alt text', () => {
    const works = clone(worksFixture) as any[];
    works[0].media.alt = '   ';
    expect(problemsFor(siteFixture, works)).toMatch(/alt text is required/);
  });

  it('rejects a duplicate slug', () => {
    const works = clone(worksFixture) as any[];
    works[1].slug = works[0].slug;
    expect(problemsFor(siteFixture, works)).toMatch(/duplicate slug "alpha"/);
  });

  it('rejects a duplicate id', () => {
    const works = clone(worksFixture) as any[];
    works[1].id = works[0].id;
    expect(problemsFor(siteFixture, works)).toMatch(/duplicate id "alpha"/);
  });

  it('rejects an unknown categoryId', () => {
    const works = clone(worksFixture) as any[];
    works[0].categoryId = 'sculpture';
    expect(problemsFor(siteFixture, works)).toMatch(/unknown categoryId "sculpture"/);
  });

  it('rejects a missing media file', () => {
    expect(problemsFor(siteFixture, worksFixture, (p) => p !== 'gamma.jpg')).toMatch(/media file not found: content\/media\/gamma\.jpg/);
  });

  it('rejects a missing poster file', () => {
    expect(problemsFor(siteFixture, worksFixture, (p) => p !== 'beta.jpg')).toMatch(/media file not found: content\/media\/beta\.jpg/);
  });

  it('rejects a video without a poster', () => {
    const works = clone(worksFixture) as any[];
    delete works[1].media.poster;
    expect(problemsFor(siteFixture, works)).toMatch(/video needs a poster/);
  });

  it('rejects a featured workId that does not exist', () => {
    const site = clone(siteFixture) as any;
    site.layout.sections[1].options.workIds.push('ghost');
    expect(problemsFor(site, worksFixture)).toMatch(/unknown work "ghost"/);
  });

  it('reports every problem, not only the first', () => {
    const works = clone(worksFixture) as any[];
    works[0].categoryId = 'x';
    works[1].categoryId = 'y';
    expect(problemsFor(siteFixture, works)).toMatch(/"x"[\s\S]*"y"/);
  });
});
