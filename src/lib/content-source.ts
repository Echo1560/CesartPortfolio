/**
 * Where the build reads content from (docs/V2-CONTRACTS.md §8).
 *
 *   CONTENT_SOURCE=local     content/*.json (v1, the default; dev and tests)
 *   CONTENT_SOURCE=supabase  the live publish snapshot, via get_published_content()
 *
 * Pure Node code with no Astro imports, so the Astro build (`content.ts`) and the
 * pre-build script (`scripts/prepare-content.ts`) share it. Every failure in
 * supabase mode throws `ContentSourceError`: the build never falls back to local
 * content and never publishes an empty site.
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Media, Site, Work } from './schema';

export type ContentSource = 'local' | 'supabase';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

/** Raw `{site, works}`, ready for `validateContent`. */
export interface ContentInput {
  site: unknown;
  works: unknown;
}

type Env = Record<string, string | undefined>;
type Fetch = typeof fetch;

/** Request timeout for the RPC and every media download. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Storage bucket that holds every media file (§4). */
export const MEDIA_BUCKET = 'media';

export class ContentSourceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ContentSourceError';
  }
}

export function contentSource(env: Env = process.env): ContentSource {
  const value = (env.CONTENT_SOURCE ?? '').trim() || 'local';
  if (value === 'local' || value === 'supabase') return value;
  throw new ContentSourceError(`CONTENT_SOURCE must be "local" or "supabase", got "${value}".`);
}

export function supabaseConfig(env: Env = process.env): SupabaseConfig {
  const url = env.PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.PUBLIC_SUPABASE_ANON_KEY?.trim();
  const missing = [!url && 'PUBLIC_SUPABASE_URL', !anonKey && 'PUBLIC_SUPABASE_ANON_KEY'].filter(Boolean);
  if (missing.length) {
    throw new ContentSourceError(`CONTENT_SOURCE=supabase needs ${missing.join(' and ')} (see .env.example).`);
  }
  try {
    new URL(url!);
  } catch {
    throw new ContentSourceError(`PUBLIC_SUPABASE_URL is not a valid URL: "${url}".`);
  }
  return { url: url!.replace(/\/+$/, ''), anonKey: anonKey! };
}

/** Headers for an anon request. Legacy anon keys are JWTs and also go in `Authorization`; new publishable keys do not. */
function anonHeaders(config: SupabaseConfig): Record<string, string> {
  const isJwt = config.anonKey.split('.').length === 3;
  return { apikey: config.anonKey, ...(isJwt ? { authorization: `Bearer ${config.anonKey}` } : {}) };
}

async function request(fetchImpl: Fetch, url: string, init: RequestInit, what: string, base: string): Promise<Response> {
  try {
    return await fetchImpl(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    const reason = timedOut ? `timed out after ${REQUEST_TIMEOUT_MS / 1000} s` : error instanceof Error ? error.message : String(error);
    throw new ContentSourceError(`Supabase unreachable at ${base} (${what}: ${reason}).`, { cause: error });
  }
}

async function bodySnippet(res: Response): Promise<string> {
  const text = await res.text().catch(() => '');
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

/**
 * Maps the `get_published_content()` response to the `Content` input.
 *
 * The database already assembles the `Content` JSON (§3), so this only checks
 * the envelope and rejects anything that is not a published snapshot. Field
 * level checks are `validateContent`'s job.
 */
export function mapSnapshot(snapshot: unknown): ContentInput {
  if (snapshot === null || snapshot === undefined) {
    throw new ContentSourceError('Supabase has no published content yet (get_published_content() returned null). Publish once from the dashboard.');
  }
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new ContentSourceError(`get_published_content() returned ${Array.isArray(snapshot) ? 'an array' : typeof snapshot}, expected {site, works}.`);
  }
  const { site, works } = snapshot as Record<string, unknown>;
  if (typeof site !== 'object' || site === null || Array.isArray(site)) {
    throw new ContentSourceError('The published snapshot has no "site" object.');
  }
  if (!Array.isArray(works)) {
    throw new ContentSourceError('The published snapshot has no "works" array.');
  }
  return { site, works };
}

/** Fetches the live snapshot with the anon key. Throws `ContentSourceError` on any failure. */
export async function fetchPublishedContent(config: SupabaseConfig, fetchImpl: Fetch = fetch): Promise<ContentInput> {
  const endpoint = `${config.url}/rest/v1/rpc/get_published_content`;
  const res = await request(
    fetchImpl,
    endpoint,
    { method: 'POST', headers: { ...anonHeaders(config), 'content-type': 'application/json', accept: 'application/json' }, body: '{}' },
    'get_published_content',
    config.url,
  );
  if (res.status !== 200) {
    throw new ContentSourceError(`get_published_content() failed at ${config.url}: HTTP ${res.status} ${await bodySnippet(res)}`.trim());
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (error) {
    throw new ContentSourceError(`get_published_content() at ${config.url} did not return JSON.`, { cause: error });
  }
  return mapSnapshot(json);
}

/** Every bucket key the content references: media `src` (not embeds), posters and the og image. Sorted, unique. */
export function mediaKeys(content: { site: Site; works: Work[] }): string[] {
  const keys = new Set<string>([content.site.meta.ogImage]);
  const add = (m: Media | undefined) => {
    if (!m) return;
    if (m.type !== 'embed') keys.add(m.src);
    if (m.poster) keys.add(m.poster);
  };
  add(content.site.hero.media);
  add(content.site.about.portrait);
  for (const w of content.works) {
    add(w.media);
    w.gallery?.forEach(add);
  }
  return [...keys].sort();
}

/** Resolves `key` under `dir`, refusing anything that escapes it (keys are already validated as relative paths). */
export function safeJoin(dir: string, key: string): string {
  const root = resolve(dir);
  const full = resolve(root, key);
  const rel = relative(root, full);
  if (!rel || rel.startsWith('..') || rel.split(sep).includes('..') || resolve(rel) === rel) {
    throw new ContentSourceError(`Refusing media key outside the media folder: "${key}".`);
  }
  return full;
}

export interface DownloadResult {
  /** Keys written because the file was new or changed. */
  written: string[];
  /** Keys whose local copy already had the same bytes. */
  unchanged: string[];
}

/**
 * Downloads every key from the private `media` bucket into `destDir/<key>`
 * (`content/media/` in the build). The anon key can read only objects listed in
 * the live snapshot (`is_published_media`), so this fetches nothing else. Any
 * failed download throws. Files with identical bytes are left untouched, so
 * committed copies of imported keys do not show up as changed.
 */
export async function downloadMedia(
  config: SupabaseConfig,
  keys: string[],
  destDir: string,
  fetchImpl: Fetch = fetch,
  concurrency = 6,
): Promise<DownloadResult> {
  const result: DownloadResult = { written: [], unchanged: [] };
  const failures: string[] = [];
  const queue = [...keys];

  async function one(key: string) {
    const target = safeJoin(destDir, key);
    const path = key.split('/').map(encodeURIComponent).join('/');
    const res = await request(
      fetchImpl,
      `${config.url}/storage/v1/object/authenticated/${MEDIA_BUCKET}/${path}`,
      { headers: anonHeaders(config) },
      `download ${key}`,
      config.url,
    );
    if (res.status !== 200) {
      failures.push(`${key}: HTTP ${res.status} ${await bodySnippet(res)}`.trim());
      return;
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length === 0) {
      failures.push(`${key}: empty file`);
      return;
    }
    const existing = await readFile(target).catch(() => undefined);
    if (existing?.equals(bytes)) {
      result.unchanged.push(key);
      return;
    }
    await mkdir(dirname(target), { recursive: true });
    const tmp = `${target}.download-${process.pid}`;
    try {
      await writeFile(tmp, bytes);
      await rename(tmp, target);
    } finally {
      await rm(tmp, { force: true });
    }
    result.written.push(key);
  }

  async function worker() {
    for (let key = queue.shift(); key !== undefined; key = queue.shift()) await one(key);
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, worker));

  if (failures.length) {
    failures.sort();
    throw new ContentSourceError(
      `Could not download ${failures.length} media file${failures.length === 1 ? '' : 's'} from ${config.url}:\n` +
        failures.map((f) => `  - ${f}`).join('\n'),
    );
  }
  result.written.sort();
  result.unchanged.sort();
  return result;
}

/** `content/media/` under the project root. */
export function mediaDir(root: string = process.cwd()): string {
  return join(root, 'content', 'media');
}
