/**
 * `npm run db:seed:generate`: writes supabase/seed.sql from content/*.json and
 * content/media/, plus a pgTAP test proving build_content() returns exactly the
 * same JSON. Run it after changing content/; `npm run db:seed:check` fails when
 * the committed files are stale.
 *
 * The seed also creates three LOCAL-ONLY test accounts (two editors, one
 * non-editor). Their passwords exist only for `supabase start` on a dev machine.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import type { Media, Site, Work } from '../src/lib/schema.ts';
import { validateContent } from '../src/lib/validate.ts';

const root = process.cwd();
const contentDir = join(root, 'content');
const mediaDir = join(contentDir, 'media');
const seedFile = join(root, 'supabase', 'seed.sql');
const testFile = join(root, 'supabase', 'tests', 'database', '01_seed_matches_content.test.sql');

/** Local test accounts. Fixed ids so tests can refer to them. Not real people's data. */
export const TEST_USERS = [
  { id: '11111111-1111-4111-8111-111111111111', email: 'cesart@example.com', name: 'Cesart', password: 'local-only-cesart-pass', editor: 'owner' },
  { id: '22222222-2222-4222-8222-222222222222', email: 'echo1560@example.com', name: 'Echo 1560', password: 'local-only-echo-pass', editor: 'owner' },
  { id: '33333333-3333-4333-8333-333333333333', email: 'visitor@example.com', name: 'Visitor', password: 'local-only-visitor-pass', editor: null },
] as const;

const MIME: Record<string, string> = {
  '.gif': 'image/gif',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const siteRaw = JSON.parse(readFileSync(join(contentDir, 'site.json'), 'utf8')) as unknown;
const worksRaw = JSON.parse(readFileSync(join(contentDir, 'works.json'), 'utf8')) as unknown;
const { site, works } = validateContent(siteRaw, worksRaw, (p) => {
  try {
    return statSync(join(mediaDir, p)).isFile();
  } catch {
    return false;
  }
});

const q = (v: string | null | undefined): string => (v == null ? 'null' : `'${v.replaceAll("'", "''")}'`);
const num = (v: number | null | undefined): string => (v == null ? 'null' : String(v));
const bool = (v: boolean | null | undefined): string => (v == null ? 'null' : v ? 'true' : 'false');
const mediaId = (path: string) => `(select id from public.media where storage_path = ${q(path)})`;

// ---------------------------------------------------------------------------
// Media library: every file referenced by content, with its kind.
// ---------------------------------------------------------------------------

interface LibraryFile {
  path: string;
  kind: 'image' | 'animated' | 'video';
  width?: number;
  height?: number;
}

const library = new Map<string, LibraryFile>();
function addFile(path: string, kind: LibraryFile['kind'], width?: number, height?: number) {
  const existing = library.get(path);
  if (existing && existing.kind !== kind) throw new Error(`${path} is used as both ${existing.kind} and ${kind}`);
  library.set(path, { path, kind, width: existing?.width ?? width, height: existing?.height ?? height });
}
function addMedia(m: Media) {
  if (m.type !== 'embed') addFile(m.src, m.type, m.width, m.height);
  if (m.poster) addFile(m.poster, 'image');
}

addFile(site.meta.ogImage, 'image');
addMedia(site.hero.media);
if (site.about.portrait) addMedia(site.about.portrait);
for (const w of works) {
  addMedia(w.media);
  for (const g of w.gallery ?? []) addMedia(g);
}

async function libraryRows(): Promise<string[]> {
  const rows: string[] = [];
  for (const file of [...library.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const full = join(mediaDir, file.path);
    const mime = MIME[extname(file.path).toLowerCase()];
    if (!mime) throw new Error(`Unsupported media type: ${file.path}`);
    let { width, height } = file;
    if (file.kind !== 'video') {
      const meta = await sharp(full).metadata();
      width = meta.width;
      height = meta.height;
    }
    rows.push(
      `  (${q(file.path)}, '${file.kind}', '${mime}', ${statSync(full).size}, ${num(width)}, ${num(height)}, ${q(file.path.split('/').pop())})`,
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

function placement(slot: string, workId: string | null, position: number, m: Media): string {
  const file = m.type === 'embed' ? undefined : library.get(m.src);
  // Store width/height only when they differ from the library file (always for embeds).
  const keepSize = !file || file.width !== m.width || file.height !== m.height;
  return `  ('${slot}', ${q(workId)}, ${position}, '${m.type}', ${m.type === 'embed' ? 'null' : mediaId(m.src)}, ${
    m.poster ? mediaId(m.poster) : 'null'
  }, ${m.type === 'embed' ? q(m.src) : 'null'}, ${q(m.provider)}, ${q(m.alt)}, ${keepSize ? num(m.width) : 'null'}, ${keepSize ? num(m.height) : 'null'}, ${bool(m.loop)})`;
}

function sectionRows(s: Site): string[] {
  return s.layout.sections.map((section, i) => {
    let options: Record<string, unknown> = {};
    if (section.id === 'featured' && section.options) {
      const { workIds: _ids, ...rest } = section.options;
      options = rest;
    } else if (section.id === 'grid' && section.options) {
      options = section.options;
    }
    return `  ('${section.id}', ${i}, ${bool(section.visible)}, ${q(JSON.stringify(options))}::jsonb)`;
  });
}

function featuredIds(s: Site): string[] {
  const section = s.layout.sections.find((x) => x.id === 'featured');
  return section?.id === 'featured' ? (section.options?.workIds ?? []) : [];
}

function workRow(w: Work): string {
  const tags = `array[${w.tags.map(q).join(', ')}]::text[]`;
  return `  (${q(w.id)}, ${q(w.slug)}, ${q(w.title)}, ${num(w.year)}, ${q(w.categoryId)}, ${tags}, ${q(w.description)}, ${bool(
    Boolean(w.featured),
  )}, ${num(w.order)}, ${bool(Boolean(w.placeholder))}, 'published')`;
}

function userRows(): string {
  const users = TEST_USERS.map(
    (u) =>
      `  ('00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated', ${q(u.email)}, extensions.crypt(${q(
        u.password,
      )}, extensions.gen_salt('bf')), now(), '{"provider": "email", "providers": ["email"]}', ${q(
        JSON.stringify({ display_name: u.name }),
      )}, now(), now(), '', '', '', '')`,
  ).join(',\n');
  const identities = TEST_USERS.map(
    (u) =>
      `  ('${u.id}', '${u.id}', '${u.id}', ${q(JSON.stringify({ sub: u.id, email: u.email, email_verified: true }))}, 'email', now(), now(), now())`,
  ).join(',\n');
  const editors = TEST_USERS.filter((u) => u.editor)
    .map((u) => `  ('${u.id}', ${q(u.email)}, ${q(u.name)}, '${u.editor}')`)
    .join(',\n');
  return `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
values
${users};

insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
values
${identities};

insert into public.editors (user_id, email, display_name, role)
values
${editors};`;
}

async function main() {
  const placements: string[] = [placement('hero', null, 0, site.hero.media)];
  if (site.about.portrait) placements.push(placement('about_portrait', null, 0, site.about.portrait));
  for (const w of works) {
    placements.push(placement('work_cover', w.id, 0, w.media));
    (w.gallery ?? []).forEach((g, i) => placements.push(placement('work_gallery', w.id, i, g)));
  }

  const seed = `-- GENERATED by scripts/generate-seed.ts from content/*.json. Do not edit by hand:
-- change content/ and run \`npm run db:seed:generate\`.
--
-- Local development and tests only. The accounts below use local-only test
-- passwords (see docs/V2-CONTRACTS.md) and example.com addresses.

-- Test accounts ---------------------------------------------------------------

${userRows()}

-- Media library ---------------------------------------------------------------

insert into public.media (storage_path, kind, mime_type, bytes, width, height, original_name)
values
${(await libraryRows()).join(',\n')};

-- Site ------------------------------------------------------------------------

insert into public.site (id, placeholder, meta_title, meta_description, meta_author, meta_lang, og_media_id, hero_heading, hero_subheading, about_heading, about_body, contact_heading, contact_email, contact_cta_label)
values (1, ${bool(Boolean(site.placeholder))}, ${q(site.meta.title)}, ${q(site.meta.description)}, ${q(site.meta.author)}, ${q(site.meta.lang)}, ${mediaId(
    site.meta.ogImage,
  )}, ${q(site.hero.heading)}, ${q(site.hero.subheading)}, ${q(site.about.heading)}, ${q(site.about.body)}, ${q(site.contact.heading)}, ${q(
    site.contact.email,
  )}, ${q(site.contact.ctaLabel)});

insert into public.socials (id, label, url, position)
values
${site.contact.socials.map((s, i) => `  (${q(s.id)}, ${q(s.label)}, ${q(s.url)}, ${i})`).join(',\n')};

insert into public.categories (id, slug, label, position)
values
${site.categories.map((c, i) => `  (${q(c.id)}, ${q(c.slug)}, ${q(c.label)}, ${i})`).join(',\n')};

-- Works -----------------------------------------------------------------------

insert into public.works (id, slug, title, year, category_id, tags, description, featured, sort_order, placeholder, status)
values
${works.map(workRow).join(',\n')};

insert into public.media_placements (slot, work_id, position, type, media_id, poster_media_id, embed_url, provider, alt, width, height, loop)
values
${placements.join(',\n')};

-- Layout ----------------------------------------------------------------------

insert into public.layout (section_id, position, visible, options)
values
${sectionRows(site).join(',\n')};
${
  featuredIds(site).length
    ? `
insert into public.layout_featured_works (work_id, position)
values
${featuredIds(site)
  .map((id, i) => `  (${q(id)}, ${i})`)
  .join(',\n')};
`
    : ''
}
-- Initial publish: the live snapshot equals content/*.json -----------------------

insert into public.publish_runs (requested_by, status, snapshot, media_paths, content_hash, finished_at)
select null, 'succeeded', c, public.snapshot_media_paths(c), encode(extensions.digest(c::text, 'sha256'), 'hex'), now()
from (select public.build_content(true) as c) s;

-- Seeding is not editor activity.
truncate public.activity_log;
`;

  const expected = JSON.stringify({ site, works });
  const test = `-- GENERATED by scripts/generate-seed.ts. Do not edit by hand.
-- Proves the seeded database maps back to exactly content/*.json.
begin;
create extension if not exists pgtap with schema extensions;
select plan(3);

select is(public.build_content(true), ${q(expected)}::jsonb, 'build_content() of the seed equals content/*.json');
select is(public.get_published_content(), ${q(expected)}::jsonb, 'the seeded live snapshot equals content/*.json');
select is(
  (select count(*)::int from public.media),
  ${library.size},
  'every referenced media file has a library row'
);

select * from finish();
rollback;
`;

  writeFileSync(seedFile, seed.replaceAll('\r\n', '\n'));
  writeFileSync(testFile, test.replaceAll('\r\n', '\n'));
  console.log(`✓ wrote supabase/seed.sql (${works.length} works, ${library.size} media files) and ${testFile.slice(root.length + 1).replaceAll('\\', '/')}`);
}

await main();
