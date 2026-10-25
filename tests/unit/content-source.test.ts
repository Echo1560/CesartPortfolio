import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContentSourceError,
  contentSource,
  downloadMedia,
  fetchPublishedContent,
  mapSnapshot,
  mediaKeys,
  safeJoin,
  supabaseConfig,
} from '../../src/lib/content-source';
import { validateContent } from '../../src/lib/validate';
import siteFixture from '../fixtures/site.json';
import worksFixture from '../fixtures/works.json';

const config = { url: 'http://127.0.0.1:54321', anonKey: 'header.payload.signature' };
const snapshot = { site: siteFixture, works: worksFixture };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('contentSource / supabaseConfig', () => {
  it('defaults to local and accepts supabase', () => {
    expect(contentSource({})).toBe('local');
    expect(contentSource({ CONTENT_SOURCE: ' ' })).toBe('local');
    expect(contentSource({ CONTENT_SOURCE: 'supabase' })).toBe('supabase');
  });

  it('rejects any other source', () => {
    expect(() => contentSource({ CONTENT_SOURCE: 'api' })).toThrow(ContentSourceError);
  });

  it('requires both env vars and a valid URL', () => {
    expect(() => supabaseConfig({})).toThrow(/PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => supabaseConfig({ PUBLIC_SUPABASE_URL: 'http://x' })).toThrow(/PUBLIC_SUPABASE_ANON_KEY/);
    expect(() => supabaseConfig({ PUBLIC_SUPABASE_URL: 'not a url', PUBLIC_SUPABASE_ANON_KEY: 'k' })).toThrow(/not a valid URL/);
    expect(supabaseConfig({ PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321/', PUBLIC_SUPABASE_ANON_KEY: 'k' })).toEqual({
      url: 'http://127.0.0.1:54321',
      anonKey: 'k',
    });
  });
});

describe('mapSnapshot', () => {
  it('passes the Content envelope through for validateContent', () => {
    const input = mapSnapshot(snapshot);
    expect(input).toEqual({ site: siteFixture, works: worksFixture });
    expect(() => validateContent(input.site, input.works, () => true)).not.toThrow();
  });

  it('fails loudly when nothing is published', () => {
    expect(() => mapSnapshot(null)).toThrow(/no published content/);
  });

  it('rejects envelopes that are not {site, works}', () => {
    expect(() => mapSnapshot([])).toThrow(/an array/);
    expect(() => mapSnapshot('x')).toThrow(/string/);
    expect(() => mapSnapshot({ works: [] })).toThrow(/"site"/);
    expect(() => mapSnapshot({ site: {}, works: {} })).toThrow(/"works"/);
  });
});

describe('fetchPublishedContent', () => {
  it('calls get_published_content with the anon key', async () => {
    const fetchMock = vi.fn(async () => json(snapshot));
    await expect(fetchPublishedContent(config, fetchMock)).resolves.toEqual(snapshot);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:54321/rest/v1/rpc/get_published_content');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` });
  });

  it('sends a publishable (non-JWT) key only as apikey', async () => {
    const fetchMock = vi.fn(async () => json(snapshot));
    await fetchPublishedContent({ ...config, anonKey: 'sb_publishable_x' }, fetchMock);
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).not.toHaveProperty('authorization');
  });

  it('reports an unreachable server with its URL', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchPublishedContent(config, fetchMock)).rejects.toThrow('Supabase unreachable at http://127.0.0.1:54321');
  });

  it('reports a timeout', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('The operation timed out.', 'TimeoutError');
    });
    await expect(fetchPublishedContent(config, fetchMock)).rejects.toThrow(/timed out after 30 s/);
  });

  it('fails on a non-200 response', async () => {
    const fetchMock = vi.fn(async () => json({ message: 'boom' }, 503));
    await expect(fetchPublishedContent(config, fetchMock)).rejects.toThrow(/HTTP 503/);
  });

  it('fails on a null snapshot and on non-JSON', async () => {
    await expect(fetchPublishedContent(config, vi.fn(async () => json(null)))).rejects.toThrow(/no published content/);
    await expect(fetchPublishedContent(config, vi.fn(async () => new Response('<html>', { status: 200 })))).rejects.toThrow(/did not return JSON/);
  });
});

describe('mediaKeys', () => {
  it('lists every file key once, skipping embeds', () => {
    const { site, works } = validateContent(siteFixture, worksFixture, () => true);
    const keys = mediaKeys({ site, works });
    expect(keys).toEqual([...new Set(keys)].sort());
    expect(keys).toContain(site.meta.ogImage);
    expect(keys.some((k) => /^https?:/.test(k))).toBe(false);
    for (const w of works) if (w.media.type !== 'embed') expect(keys).toContain(w.media.src);
  });
});

describe('safeJoin', () => {
  it('keeps keys inside the folder', () => {
    expect(safeJoin('/m', 'uploads/a.jpg')).toMatch(/uploads[\\/]a\.jpg$/);
    expect(() => safeJoin('/m', '../a.jpg')).toThrow(ContentSourceError);
    expect(() => safeJoin('/m', 'a/../../b.jpg')).toThrow(ContentSourceError);
    expect(() => safeJoin('/m', '')).toThrow(ContentSourceError);
  });
});

describe('downloadMedia', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cesart-dl-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('downloads each key from the authenticated object endpoint', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(`bytes of ${url.split('/media/')[1]}`));
    const result = await downloadMedia(config, ['uploads/a b.jpg', 'placeholder/c.gif'], dir, fetchMock as unknown as typeof fetch);
    expect(result).toEqual({ written: ['placeholder/c.gif', 'uploads/a b.jpg'], unchanged: [] });
    expect(fetchMock.mock.calls.map((c) => c[0]).sort()).toEqual([
      'http://127.0.0.1:54321/storage/v1/object/authenticated/media/placeholder/c.gif',
      'http://127.0.0.1:54321/storage/v1/object/authenticated/media/uploads/a%20b.jpg',
    ]);
    expect(readFileSync(join(dir, 'uploads', 'a b.jpg'), 'utf8')).toBe('bytes of uploads/a%20b.jpg');
  });

  it('leaves files with identical bytes untouched', async () => {
    mkdirSync(join(dir, 'p'));
    writeFileSync(join(dir, 'p', 'same.jpg'), 'same');
    const before = statSync(join(dir, 'p', 'same.jpg')).mtimeMs;
    const result = await downloadMedia(config, ['p/same.jpg'], dir, vi.fn(async () => new Response('same')));
    expect(result.unchanged).toEqual(['p/same.jpg']);
    expect(statSync(join(dir, 'p', 'same.jpg')).mtimeMs).toBe(before);
  });

  it('fails when any download fails, listing every failure', async () => {
    const fetchMock = vi.fn(async (url: string) => (url.endsWith('ok.jpg') ? new Response('x') : new Response('not found', { status: 400 })));
    await expect(downloadMedia(config, ['ok.jpg', 'a/missing.jpg', 'b/missing.jpg'], dir, fetchMock as unknown as typeof fetch)).rejects.toThrow(
      /Could not download 2 media files[\s\S]*a\/missing\.jpg: HTTP 400[\s\S]*b\/missing\.jpg/,
    );
  });

  it('fails on empty files and on unreachable storage', async () => {
    await expect(downloadMedia(config, ['a/e.jpg'], dir, vi.fn(async () => new Response('')))).rejects.toThrow(/empty file/);
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(downloadMedia(config, ['a/e.jpg'], dir, down)).rejects.toThrow(/Supabase unreachable/);
  });
});

describe('content.ts with CONTENT_SOURCE=supabase', () => {
  const env = { CONTENT_SOURCE: 'supabase', PUBLIC_SUPABASE_URL: config.url, PUBLIC_SUPABASE_ANON_KEY: config.anonKey };

  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock('node:fs');
  });

  async function importContent() {
    // Pretend every media file was downloaded.
    vi.doMock('node:fs', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:fs')>()),
      existsSync: () => true,
      statSync: () => ({ isFile: () => true }),
    }));
    return import('../../src/lib/content');
  }

  it('builds from the published snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(snapshot)));
    const content = await importContent();
    expect((await content.getSite()).meta.title).toBe(siteFixture.meta.title);
    expect((await content.getWorks()).length).toBe(worksFixture.length);
  });

  it('fails the build when the snapshot does not validate', async () => {
    const broken = { site: siteFixture, works: [{ ...worksFixture[0], categoryId: 'no-such-category' }] };
    vi.stubGlobal('fetch', vi.fn(async () => json(broken)));
    const content = await importContent();
    await expect(content.getSite()).rejects.toThrow(content.ContentError); // fresh module graph: compare with its own class
    await expect(content.getWorks()).rejects.toThrow(/unknown categoryId "no-such-category"/);
  });

  it('fails the build when Supabase is down, never falling back to local content', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    const content = await importContent();
    await expect(content.getSite()).rejects.toThrow(/Supabase unreachable at http:\/\/127\.0\.0\.1:54321/);
  });

  it('fails the build when nothing is published', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(null)));
    const content = await importContent();
    await expect(content.getWorks()).rejects.toThrow(/no published content/);
  });
});
