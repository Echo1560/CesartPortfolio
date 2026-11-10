import { describe, expect, it } from 'vitest';
import { pageSlug } from '../../src/lib/schema-v3';
import { suggestSlug } from '../../src/admin/views/pages';

describe('suggestSlug', () => {
  it('kebab-cases the title', () => {
    expect(suggestSlug('My Commissions!', [])).toBe('my-commissions');
  });

  it('falls back to "page" when the title has no usable characters', () => {
    expect(suggestSlug('???', [])).toBe('page');
  });

  it('avoids a reserved slug', () => {
    expect(suggestSlug('Admin', [])).toBe('admin-page');
    expect(suggestSlug('Works', [])).toBe('works-page');
  });

  it('numbers the slug until it is free', () => {
    expect(suggestSlug('Journal', ['journal'])).toBe('journal-2');
    expect(suggestSlug('Journal', ['journal', 'journal-2'])).toBe('journal-3');
  });

  it('keeps a taken reserved base distinct too', () => {
    expect(suggestSlug('Admin', ['admin-page'])).toBe('admin-page-2');
  });

  it('truncates long titles without leaving a trailing dash', () => {
    const slug = suggestSlug(`${'a'.repeat(89)} bbbbbb`, []);
    expect(slug).toBe('a'.repeat(89));
    expect(slug.length).toBeLessThanOrEqual(90);
  });

  it('always yields a slug the schema accepts', () => {
    for (const title of ['Hello World', 'Ünïcode Títle', `${'a'.repeat(89)} bbbbbb`, '404', 'Index', '___']) {
      expect(pageSlug.safeParse(suggestSlug(title, [])).success, title).toBe(true);
    }
  });
});
