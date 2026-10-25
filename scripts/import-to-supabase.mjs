/**
 * `npm run db:import`: one-off import of content/*.json and content/media/ into
 * a Supabase project (local or hosted). Idempotent: running it again leaves the
 * same state.
 *
 *   SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=... npm run db:import
 *   npm run db:import -- --publish            also make the imported draft live
 *   npm run db:import -- --hosted --publish   required for any non-local URL
 *
 * What it does:
 *   1. validates content/ exactly like the build
 *   2. uploads every referenced file to the private `media` bucket under its
 *      content path (upsert), for example `placeholder/illustration-01.jpg`
 *   3. upserts the draft tables (media, site, socials, categories, works,
 *      layout) and replaces the placements and featured list of the imported
 *      content. Rows that are not in content/ (other works, uploads) are kept.
 *   4. with --publish: stores a `succeeded` publish run whose snapshot is
 *      build_content(true), unless the live snapshot already equals it
 *
 * The service-role key bypasses RLS. It is read from the environment only
 * (SUPABASE_SERVICE_ROLE_KEY, or a git-ignored .env), never from a file in the
 * repo, and never printed. For local Supabase: `npx supabase status -o env`.
 *
 * Draft tables only change in step 3, and the public site reads only the
 * published snapshot, so the short gap between the placement delete and insert
 * is never visible to visitors.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { mediaKeys } from '../src/lib/content-source.ts';
import { validateContent } from '../src/lib/validate.ts';

const root = process.cwd();
const contentDir = join(root, 'content');
const mediaDir = join(contentDir, 'media');
const args = new Set(process.argv.slice(2));
const PUBLISH = args.has('--publish');
const HOSTED = args.has('--hosted');
const BUCKET = 'media';

const MIME = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (existsSync(join(root, '.env'))) process.loadEnvFile(join(root, '.env'));
const url = (process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
if (!url) fail('Set SUPABASE_URL (or PUBLIC_SUPABASE_URL).');
if (!serviceKey) fail('Set SUPABASE_SERVICE_ROLE_KEY in the environment. Never commit it.');
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
if (!isLocal && !HOSTED) fail(`${url} is not a local Supabase. Pass --hosted to import into a hosted project.`);

const auth = { apikey: serviceKey, ...(serviceKey.split('.').length === 3 ? { authorization: `Bearer ${serviceKey}` } : {}) };

async function api(method, path, { body, headers = {}, raw = false } = {}) {
  let res;
  try {
    res = await fetch(url + path, {
      method,
      headers: { ...auth, ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    fail(`Supabase unreachable at ${url} (${method} ${path.split('?')[0]}: ${error.message})`);
  }
  const text = await res.text();
  if (!res.ok) fail(`${method} ${path.split('?')[0]} → HTTP ${res.status}: ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

const rest = (method, table, query, body, prefer) =>
  api(method, `/rest/v1/${table}${query ? `?${query}` : ''}`, { body, headers: prefer ? { prefer } : {} });
const upsert = (table, conflict, rows) =>
  rows.length ? rest('POST', table, `on_conflict=${conflict}`, rows, 'resolution=merge-duplicates,return=representation') : [];
const rpc = (name, body = {}) => api('POST', `/rest/v1/rpc/${name}`, { body });

// 1. Validate --------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(join(contentDir, file), 'utf8'));
const fileExists = (p) => existsSync(join(mediaDir, p)) && statSync(join(mediaDir, p)).isFile();
const { site, works } = validateContent(readJson('site.json'), readJson('works.json'), fileExists);
console.log(`→ ${isLocal ? 'local' : 'HOSTED'} project ${url}: ${works.length} works, ${site.categories.length} categories`);

// Media library: every referenced file and the kind it is used as.
const kinds = new Map([[site.meta.ogImage, 'image']]);
const allMedia = [site.hero.media, site.about.portrait, ...works.flatMap((w) => [w.media, ...(w.gallery ?? [])])].filter(Boolean);
for (const m of allMedia) {
  if (m.type !== 'embed') {
    const prev = kinds.get(m.src);
    if (prev && prev !== m.type) fail(`${m.src} is used as both ${prev} and ${m.type}`);
    kinds.set(m.src, m.type);
  }
  if (m.poster) kinds.set(m.poster, kinds.get(m.poster) ?? 'image');
}
const keys = mediaKeys({ site, works });

// 2. Upload files ----------------------------------------------------------------

for (const key of keys) {
  const mime = MIME[extname(key).toLowerCase()];
  if (!mime) fail(`Unsupported media type: ${key}`);
  await api('POST', `/storage/v1/object/${BUCKET}/${key.split('/').map(encodeURIComponent).join('/')}`, {
    body: readFileSync(join(mediaDir, key)),
    raw: true,
    headers: { 'content-type': mime, 'x-upsert': 'true', 'cache-control': 'max-age=3600' },
  });
}
console.log(`→ storage: ${keys.length} files uploaded to bucket "${BUCKET}"`);

// 3. Draft tables ------------------------------------------------------------------

async function libraryRow(key) {
  const full = join(mediaDir, key);
  const kind = kinds.get(key);
  let width = null;
  let height = null;
  if (kind === 'video') {
    const used = allMedia.find((m) => m.src === key);
    width = used?.width ?? null;
    height = used?.height ?? null;
  } else {
    const meta = await sharp(full).metadata();
    width = meta.width;
    height = meta.pageHeight ?? meta.height;
  }
  return { storage_path: key, kind, mime_type: MIME[extname(key).toLowerCase()], bytes: statSync(full).size, width, height, original_name: key.split('/').pop() };
}

const mediaRows = await upsert('media', 'storage_path', await Promise.all(keys.map(libraryRow)));
const mediaIds = new Map(mediaRows.map((r) => [r.storage_path, r.id]));
const library = new Map(mediaRows.map((r) => [r.storage_path, r]));

await upsert('site', 'id', [
  {
    id: 1,
    placeholder: Boolean(site.placeholder),
    meta_title: site.meta.title,
    meta_description: site.meta.description,
    meta_author: site.meta.author,
    meta_lang: site.meta.lang,
    og_media_id: mediaIds.get(site.meta.ogImage),
    hero_heading: site.hero.heading,
    hero_subheading: site.hero.subheading,
    about_heading: site.about.heading,
    about_body: site.about.body,
    contact_heading: site.contact.heading,
    contact_email: site.contact.email,
    contact_cta_label: site.contact.ctaLabel,
  },
]);
await upsert('socials', 'id', site.contact.socials.map((s, position) => ({ id: s.id, label: s.label, url: s.url, position })));
await upsert('categories', 'id', site.categories.map((c, position) => ({ id: c.id, slug: c.slug, label: c.label, position })));
await upsert(
  'works',
  'id',
  works.map((w) => ({
    id: w.id,
    slug: w.slug,
    title: w.title,
    year: w.year ?? null,
    category_id: w.categoryId,
    tags: w.tags,
    description: w.description,
    featured: Boolean(w.featured),
    sort_order: w.order ?? null,
    placeholder: Boolean(w.placeholder),
    status: 'published',
  })),
);

function placement(slot, workId, position, m) {
  const file = m.type === 'embed' ? undefined : library.get(m.src);
  // Store width/height only when they differ from the library file (always for embeds), as the seed does.
  const keepSize = !file || file.width !== m.width || file.height !== m.height;
  return {
    slot,
    work_id: workId,
    position,
    type: m.type,
    media_id: m.type === 'embed' ? null : mediaIds.get(m.src),
    poster_media_id: m.poster ? mediaIds.get(m.poster) : null,
    embed_url: m.type === 'embed' ? m.src : null,
    provider: m.provider ?? null,
    alt: m.alt,
    width: keepSize ? m.width : null,
    height: keepSize ? m.height : null,
    loop: m.loop ?? null,
  };
}

const placements = [placement('hero', null, 0, site.hero.media)];
if (site.about.portrait) placements.push(placement('about_portrait', null, 0, site.about.portrait));
for (const w of works) {
  placements.push(placement('work_cover', w.id, 0, w.media));
  (w.gallery ?? []).forEach((g, i) => placements.push(placement('work_gallery', w.id, i, g)));
}
const workList = works.map((w) => `"${w.id}"`).join(',');
await rest('DELETE', 'media_placements', 'slot=in.(hero,about_portrait)');
if (works.length) await rest('DELETE', 'media_placements', `work_id=in.(${workList})`);
await rest('POST', 'media_placements', '', placements, 'return=minimal');

const featured = site.layout.sections.find((s) => s.id === 'featured');
await upsert(
  'layout',
  'section_id',
  site.layout.sections.map((section, position) => {
    let options = {};
    if (section.id === 'featured' && section.options) {
      const { workIds: _ids, ...rest } = section.options;
      options = rest;
    } else if (section.id === 'grid' && section.options) {
      options = section.options;
    }
    return { section_id: section.id, position, visible: section.visible, options };
  }),
);
await rest('DELETE', 'layout_featured_works', 'work_id=not.is.null');
const featuredIds = featured?.options?.workIds ?? [];
if (featuredIds.length) {
  await rest('POST', 'layout_featured_works', '', featuredIds.map((work_id, position) => ({ work_id, position })), 'return=minimal');
}
console.log(`→ draft: site, ${site.contact.socials.length} socials, ${site.categories.length} categories, ${works.length} works, ${placements.length} placements, ${site.layout.sections.length} layout sections`);

// 4. Publish -------------------------------------------------------------------------

if (PUBLISH) {
  const snapshot = await rpc('build_content', { p_published_only: true });
  const live = await rpc('get_published_content');
  const canonical = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));
  if (live && canonical(live) === canonical(snapshot)) {
    console.log('→ publish: the live snapshot already matches, nothing to do');
  } else {
    await rest('POST', 'publish_runs', '', {
      status: 'succeeded',
      snapshot,
      media_paths: await rpc('snapshot_media_paths', { p_snapshot: snapshot }),
      content_hash: createHash('sha256').update(canonical(snapshot)).digest('hex'),
      finished_at: new Date().toISOString(),
    }, 'return=minimal');
    console.log('→ publish: stored a succeeded publish run; the imported content is live');
  }
}

console.log('✓ import complete');
