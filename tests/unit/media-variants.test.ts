import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasVariants, variantKeys, videoSources } from '../../src/lib/media-variants';
import { findFfmpeg, generateVariants, variantHash } from '../../scripts/lib/variants';

describe('media variant resolver', () => {
  it('applies to animated GIF and WebP only', () => {
    expect(hasVariants({ type: 'animated', src: 'a/loop.gif' })).toBe(true);
    expect(hasVariants({ type: 'animated', src: 'a/LOOP.GIF' })).toBe(true);
    expect(hasVariants({ type: 'animated', src: 'a/loop.webp' })).toBe(true);
    expect(hasVariants({ type: 'image', src: 'a/still.gif' })).toBe(false);
    expect(hasVariants({ type: 'video', src: 'a/clip.mp4' })).toBe(false);
  });

  it('names variants after the source key', () => {
    expect(variantKeys('uploads/x.gif')).toEqual({ webm: 'uploads/x.gif.webm', mp4: 'uploads/x.gif.mp4', poster: 'uploads/x.gif.poster.jpg' });
  });

  it('lists WebM before MP4', async () => {
    const urls: Record<string, string> = { 'a.gif.webm': '/_astro/a.1.webm', 'a.gif.mp4': '/_astro/a.2.mp4' };
    await expect(videoSources('a.gif', async (k) => urls[k])).resolves.toEqual([
      { src: '/_astro/a.1.webm', mimeType: 'video/webm' },
      { src: '/_astro/a.2.mp4', mimeType: 'video/mp4' },
    ]);
  });

  it('keeps only the variants that exist, and [] when none were generated', async () => {
    await expect(videoSources('a.gif', async (k) => (k.endsWith('.mp4') ? '/m.mp4' : undefined))).resolves.toEqual([
      { src: '/m.mp4', mimeType: 'video/mp4' },
    ]);
    await expect(videoSources('a.gif', async () => undefined)).resolves.toEqual([]);
  });
});

const ffmpeg = findFfmpeg();

describe.skipIf(!ffmpeg)('generateVariants (ffmpeg)', () => {
  let dir: string;
  const media = () => join(dir, 'media');
  const out = () => join(dir, 'generated');
  const cacheDir = () => join(dir, 'cache');

  async function animation(file: string, format: 'gif' | 'webp') {
    // Odd size on purpose: yuv420p needs even dimensions. Transparent background.
    const frames = await Promise.all(
      [0, 1, 2, 3].map((i) =>
        sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="41" height="31"><circle cx="${8 + i * 8}" cy="15" r="6" fill="#c33"/></svg>`))
          .png()
          .toBuffer(),
      ),
    );
    const anim = sharp(frames, { join: { animated: true } });
    const delay = [200, 100, 100, 200];
    await (format === 'gif' ? anim.gif({ loop: 0, delay }) : anim.webp({ loop: 0, delay })).toFile(join(media(), file));
  }

  async function probe(file: string): Promise<string> {
    const { spawnSync } = await import('node:child_process');
    return spawnSync(ffmpeg!, ['-hide_banner', '-i', file], { encoding: 'utf8' }).stderr;
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'cesart-variants-'));
    mkdirSync(join(media(), 'uploads'), { recursive: true });
    await animation('uploads/loop.gif', 'gif');
    await animation('uploads/loop.webp', 'webp');
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each(['uploads/loop.gif', 'uploads/loop.webp'])('turns %s into WebM, MP4 and a poster', { timeout: 60_000 }, async (key) => {
    const result = await generateVariants(media(), key, out(), { ffmpeg: ffmpeg!, cacheDir: cacheDir() });
    expect(result.cached).toBe(false);
    for (const file of Object.values(result.files)) expect(statSync(file).size).toBeGreaterThan(0);
    expect(result.files.webm).toBe(join(out(), `${key}.webm`));

    const mp4 = await probe(result.files.mp4);
    expect(mp4).toMatch(/Video: h264.*yuv420p.*40x30/);
    expect(mp4).not.toMatch(/Audio:/);
    expect(mp4).toMatch(/Duration: 00:00:00\.(5|6)\d/);
    const webm = await probe(result.files.webm);
    expect(webm).toMatch(/Video: vp9.*yuv420p.*40x30/);
    expect(webm).not.toMatch(/Audio:/);

    const poster = await sharp(result.files.poster).metadata();
    expect([poster.format, poster.width, poster.height]).toEqual(['jpeg', 41, 31]);
  });

  it('streams long animated WebP in decode batches with correct timing', { timeout: 60_000 }, async () => {
    // 40 frames at 50 ms crosses the 16-frame decode batch twice; each frame moves the dot.
    const frames = await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="20"><circle cx="${2 + i * 2}" cy="10" r="2" fill="#c33"/></svg>`))
          .png()
          .toBuffer(),
      ),
    );
    await sharp(frames, { join: { animated: true } }).webp({ loop: 0, delay: Array(40).fill(50), lossless: true }).toFile(join(media(), 'uploads/long.webp'));
    const result = await generateVariants(media(), 'uploads/long.webp', out(), { ffmpeg: ffmpeg!, cacheDir: cacheDir() });
    const info = await probe(result.files.mp4);
    expect(info).toMatch(/Duration: 00:00:0(1\.9\d|2\.0\d)/);
    expect(info).toMatch(/ 20 fps/);
  });

  it('reuses cached outputs keyed by content hash', { timeout: 60_000 }, async () => {
    const key = 'uploads/loop.gif';
    rmSync(out(), { recursive: true, force: true });
    const again = await generateVariants(media(), key, out(), { ffmpeg: ffmpeg!, cacheDir: cacheDir() });
    expect(again.cached).toBe(true);
    expect(again.hash).toBe(variantHash(readFileSync(join(media(), key))));
    expect(existsSync(join(out(), `${key}.mp4`))).toBe(true);
  });
});
