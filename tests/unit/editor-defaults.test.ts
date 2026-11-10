import { describe, expect, it } from 'vitest';
import { ALL_BLOCK_TYPES, ALL_SECTION_TYPES, newBlock, newSection } from '../../src/admin/editor/defaults';
import { checkBlock, checkSection } from '../../src/admin/editor/model';

const media = { mediaId: '11111111-1111-4111-8111-111111111111', type: 'image', src: 'a.webp', alt: 'A drawing', width: 1, height: 1 };
const video = { ...media, type: 'video', posterId: '22222222-2222-4222-8222-222222222222', poster: 'p.webp' };
const works = ['one', 'two', 'three', 'four'].map((id) => ({ id }));

describe('editor defaults', () => {
  it.each(ALL_SECTION_TYPES)('the default %s section passes checkSection', (type) => {
    expect(() => checkSection(newSection(type, { works, email: 'a@b.co', media }))).not.toThrow();
  });

  it.each(ALL_BLOCK_TYPES)('the default %s block passes checkBlock', (type) => {
    expect(() => checkBlock(newBlock(type, 0, type === 'video' ? video : media))).not.toThrow();
  });

  it('the blocks inside flexible sections pass checkBlock', () => {
    for (const type of ALL_SECTION_TYPES) for (const b of newSection(type, { works, media }).blocks ?? []) expect(() => checkBlock(b)).not.toThrow();
  });

  it('a featured section with no works passes and starts empty', () => {
    const s = newSection('featured', { works: [] });
    expect((s.settings as { workIds: string[] }).workIds).toEqual([]);
    expect(() => checkSection(s)).not.toThrow();
  });

  it('a featured section picks at most three works', () => {
    expect((newSection('featured', { works }).settings as { workIds: string[] }).workIds).toEqual(['one', 'two', 'three']);
  });

  it('a contact section with no email still gets a valid placeholder', () => {
    const s = newSection('contact', { works });
    expect((s.content as { email: string }).email).toBeTruthy();
    expect(() => checkSection(s)).not.toThrow();
  });
});
