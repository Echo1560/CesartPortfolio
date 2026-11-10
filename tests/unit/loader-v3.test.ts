import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapSnapshot, readSnapshot, writeSnapshot } from '../../src/lib/content-source';
import type { SnapshotV3 } from '../../src/lib/schema-v3';
import { ContentError } from '../../src/lib/validate';
import { snapshotAnimatedKeys, snapshotMediaKeys, validateSnapshotV3, withoutHidden } from '../../src/lib/validate-v3';

const fixture = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'snapshot-v3.json'), 'utf8')) as SnapshotV3;
const config = { url: 'http://127.0.0.1:54321', anonKey: 'header.payload.signature' };
const all = () => true;

const everywhere = { desktop: true, tablet: true, mobile: true };
const nowhere = { desktop: false, tablet: false, mobile: false };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const media = (src: string, extra: Record<string, unknown> = {}) => ({ type: 'image', src, alt: 'Alt', width: 10, height: 10, mediaId: uuid(900), ...extra });
const words = (t: string) => [{ type: 'text', text: t }];

/** A text section with a heading, a video and an image block, and a background image. */
function textSection(id: number, visibility = everywhere, blockVisibility = everywhere) {
  return {
    id: uuid(id),
    type: 'text',
    variant: 'default',
    settings: { backgroundImage: { image: media(`bg/section-${id}.jpg`), overlay: 20 } },
    content: {},
    visibility,
    blocks: [
      { id: uuid(id * 10 + 1), type: 'heading', column: 0, settings: {}, content: { text: words('Hi'), level: 2 }, visibility: everywhere },
      {
        id: uuid(id * 10 + 2),
        type: 'video',
        column: 0,
        settings: {},
        content: { media: media(`video/clip-${id}.mp4`, { type: 'video', poster: `video/clip-${id}.jpg`, posterId: uuid(901) }), autoplay: true },
        visibility: everywhere,
      },
      { id: uuid(id * 10 + 3), type: 'image', column: 0, settings: {}, content: { media: media(`img/hidden-block-${id}.gif`, { type: 'animated' }) }, visibility: blockVisibility },
    ],
  };
}

/** The fixture plus a second page with two text sections (one hidden everywhere) and a social image. */
function withSecondPage(): SnapshotV3 {
  const snap = structuredClone(fixture) as unknown as { pages: unknown[] };
  snap.pages.push({
    id: uuid(1),
    slug: 'commissions',
    title: 'Commissions',
    status: 'published',
    isHome: false,
    seo: { ogImage: 'og/commissions.jpg', ogImageId: uuid(902) },
    sections: [textSection(2, everywhere, nowhere), textSection(3, nowhere)],
  });
  return snap as unknown as SnapshotV3;
}

describe('validateSnapshotV3', () => {
  it('accepts the snapshot the seeded database publishes', () => {
    const snap = validateSnapshotV3(fixture, all);
    expect(snap.version).toBe(3);
    expect(snap.pages.map((p) => p.slug)).toEqual(['home']);
    expect(snap.theme.preset).toBe('classic');
  });

  it('accepts a page with flexible sections, blocks and background images', () => {
    const snap = validateSnapshotV3(withSecondPage(), all);
    expect(snap.pages[1]!.slug).toBe('commissions');
  });

  it('names the path of every shape error', () => {
    const bad = structuredClone(fixture) as unknown as { pages: { slug: string; sections: { variant: string }[] }[] };
    bad.pages[0]!.slug = 'admin';
    bad.pages[0]!.sections[0]!.variant = 'sparkly';
    const error = (() => {
      try {
        validateSnapshotV3(bad, all);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ContentError);
    const message = (error as Error).message;
    expect(message).toMatch(/snapshot → pages\[0\]\.slug: .*reserved/);
    expect(message).toMatch(/snapshot → pages\[0\]\.sections\[0\]\.variant/);
  });

  it('rejects a v2 snapshot (no version, pages or theme)', () => {
    expect(() => validateSnapshotV3({ site: fixture.site, works: fixture.works }, all)).toThrow(ContentError);
  });

  it('lists every missing media file, including section and block media', () => {
    const missing = new Set(['bg/section-2.jpg', 'video/clip-2.jpg', fixture.works[0]!.media.src]);
    expect(() => validateSnapshotV3(withSecondPage(), (key) => !missing.has(key))).toThrow(
      new RegExp([...missing].sort().map((k) => `media file not found: content/media/${k.replace('.', '\\.')}`).join('[\\s\\S]*')),
    );
  });

  it('does not need the media of sections or blocks hidden on every device', () => {
    const hidden = new Set(['bg/section-3.jpg', 'video/clip-3.mp4', 'video/clip-3.jpg', 'img/hidden-block-2.gif']);
    expect(() => validateSnapshotV3(withSecondPage(), (key) => !hidden.has(key))).not.toThrow();
  });

  it('reports duplicate work and page ids', () => {
    const snap = withSecondPage() as unknown as { pages: { id: string }[]; works: { id: string }[] };
    snap.pages[1]!.id = snap.pages[0]!.id;
    snap.works.push(structuredClone(snap.works[0]!));
    expect(() => validateSnapshotV3(snap, all)).toThrow(/duplicate id[\s\S]*duplicate slug[\s\S]*pages: duplicate id/);
  });
});

describe('withoutHidden', () => {
  it('drops sections and blocks hidden on every device and keeps the rest in order', () => {
    const snap = withoutHidden(withSecondPage());
    const page = snap.pages[1]!;
    expect(page.sections.map((s) => s.id)).toEqual([uuid(2)]);
    expect((page.sections[0] as unknown as { blocks: { id: string }[] }).blocks.map((b) => b.id)).toEqual([uuid(21), uuid(22)]);
    expect(snap.pages[0]).toEqual(fixture.pages[0]);
  });

  it('keeps a section hidden on some devices (CSS hides it there)', () => {
    const snap = withSecondPage() as unknown as { pages: { sections: { visibility: unknown }[] }[] };
    snap.pages[1]!.sections[1]!.visibility = { desktop: false, tablet: false, mobile: true };
    expect(withoutHidden(snap as unknown as SnapshotV3).pages[1]!.sections).toHaveLength(2);
  });
});

describe('media keys', () => {
  it('collects works, section, block, poster and social image keys of what the build renders', () => {
    const keys = snapshotMediaKeys(validateSnapshotV3(withSecondPage(), all));
    expect(keys).toEqual(expect.arrayContaining(['bg/section-2.jpg', 'video/clip-2.mp4', 'video/clip-2.jpg', 'og/commissions.jpg', fixture.site.meta.ogImage]));
    expect(keys).toEqual(expect.arrayContaining(fixture.works.map((w) => w.media.src)));
    expect(keys).not.toContain('bg/section-3.jpg');
    expect(keys).not.toContain('img/hidden-block-2.gif');
    expect(keys).toEqual([...new Set(keys)].sort());
  });

  it('lists the animated GIF/WebP sources that need video variants', () => {
    const snap = withSecondPage() as unknown as { pages: { sections: { blocks: { visibility: unknown }[] }[] }[] };
    snap.pages[1]!.sections[0]!.blocks[2]!.visibility = everywhere;
    const keys = snapshotAnimatedKeys(validateSnapshotV3(snap, all));
    expect(keys).toContain('img/hidden-block-2.gif');
    expect(keys).toEqual(expect.arrayContaining(fixture.works.filter((w) => w.media.type === 'animated').map((w) => w.media.src)));
    expect(keys.every((k) => /\.(gif|webp)$/.test(k))).toBe(true);
  });
});

describe('Supabase source (v3)', () => {
  it('mapSnapshot passes version, pages and theme through', () => {
    expect(mapSnapshot(fixture)).toEqual({ site: fixture.site, works: fixture.works, version: 3, pages: fixture.pages, theme: fixture.theme });
  });

  describe('getSnapshot()', () => {
    const env = { CONTENT_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: config.url, PUBLIC_SUPABASE_ANON_KEY: config.anonKey };
    let dir: string;

    beforeEach(() => {
      vi.resetModules();
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      dir = mkdtempSync(join(tmpdir(), 'cesart-v3-'));
      vi.spyOn(process, 'cwd').mockReturnValue(dir);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('unexpected network call from astro build');
        }),
      );
    });
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
      vi.doUnmock('node:fs');
      rmSync(dir, { recursive: true, force: true });
    });

    async function importContent() {
      vi.doMock('node:fs', async (importOriginal) => ({
        ...(await importOriginal<typeof import('node:fs')>()),
        existsSync: () => true,
        statSync: () => ({ isFile: () => true }),
      }));
      return import('../../src/lib/content');
    }

    it('round-trips the prepared v3 snapshot without a network call, minus hidden sections', async () => {
      const snap = withSecondPage();
      await writeSnapshot(dir, config, mapSnapshot(snap));
      expect((await readSnapshot(dir, config)).pages).toEqual(snap.pages);
      const content = await importContent();
      const loaded = await content.getSnapshot();
      expect(loaded.pages.map((p) => p.slug)).toEqual(['home', 'commissions']);
      expect(loaded.pages[1]!.sections).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('fails the build on a v2 snapshot', async () => {
      await writeSnapshot(dir, config, { site: fixture.site, works: fixture.works });
      const content = await importContent();
      await expect(content.getSnapshot()).rejects.toThrow(/not version 3/);
    });

    it('fails the build when the v3 snapshot does not validate', async () => {
      const snap = structuredClone(fixture) as unknown as { pages: { isHome: boolean }[] };
      snap.pages[0]!.isHome = false;
      await writeSnapshot(dir, config, mapSnapshot(snap));
      const content = await importContent();
      await expect(content.getSnapshot()).rejects.toThrow(content.ContentError);
    });
  });
});
