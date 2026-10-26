import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Media } from '../../src/lib/schema';

// Only the animated branch (no poster) is exercised, so the image pipeline is never called.
vi.mock('astro:assets', () => ({ getImage: vi.fn() }));

// media.ts resolves files with import.meta.glob over content/media, which is evaluated when the module is
// transformed. Write throwaway fixture files first and import the module afterwards.
const DIR = 'unit-animated-fixture';
const ABS = join(__dirname, '..', '..', 'content', 'media', DIR);
const FILES = ['both.gif', 'both.webm', 'both.mp4', 'mp4only.gif', 'mp4only.mp4', 'none.gif'];

type MediaModule = typeof import('../../src/lib/media');
let media: MediaModule;

const animated = (name: string, extra: Partial<Media> = {}) =>
  ({ type: 'animated', src: `${DIR}/${name}`, alt: 'loop', width: 64, height: 48, ...extra }) as Media;

beforeAll(async () => {
  mkdirSync(ABS, { recursive: true });
  for (const f of FILES) writeFileSync(join(ABS, f), 'x');
  media = await import('../../src/lib/media');
});

afterAll(() => rmSync(ABS, { recursive: true, force: true }));

describe('resolveMedia (animated)', () => {
  it('returns no video sources when no sibling variants exist', async () => {
    const r = await media.resolveMedia(animated('none.gif'));
    expect(r.type === 'animated' && r.sources).toEqual([]);
  });

  it('returns WebM first, then MP4, when both variants exist', async () => {
    const r = await media.resolveMedia(animated('both.gif'));
    expect(r.type === 'animated' && r.sources.map((s) => s.mimeType)).toEqual(['video/webm', 'video/mp4']);
  });

  it('returns only the MP4 source when just that variant exists', async () => {
    const r = await media.resolveMedia(animated('mp4only.gif'));
    expect(r.type === 'animated' && r.sources.map((s) => s.mimeType)).toEqual(['video/mp4']);
  });

  it('points each source at its own file and keeps the GIF as src', async () => {
    const r = await media.resolveMedia(animated('both.gif'));
    if (r.type !== 'animated') throw new Error('expected animated');
    expect(r.sources[0].src).toMatch(/both.*\.webm/);
    expect(r.sources[1].src).toMatch(/both.*\.mp4/);
    expect(r.src).toMatch(/both.*\.gif/);
  });

  it('takes width and height from the metadata and defaults loop to true', async () => {
    const r = await media.resolveMedia(animated('none.gif'));
    expect(r).toMatchObject({ width: 64, height: 48, loop: true });
  });
});
