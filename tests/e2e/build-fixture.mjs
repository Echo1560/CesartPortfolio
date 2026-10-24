// Builds a throwaway copy of the site whose content/ is edited, to prove that
// layout and works are data-driven: no source file is touched, only content.
// Output: .e2e-fixture/dist, served under /CesartPortfolio/ by `astro preview`.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_ROOT = join(root, '.e2e-fixture');

/** Slug and media file of the work added with content only (no code change). */
export const ADDED_WORK = { id: 'e2e-added-work', slug: 'e2e-added-work', title: 'E2E Added Work' };

export function buildFixture() {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  for (const entry of ['src', 'public', 'scripts', 'content', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    cpSync(join(root, entry), join(FIXTURE_ROOT, entry), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(FIXTURE_ROOT, 'node_modules'), 'junction');

  const siteFile = join(FIXTURE_ROOT, 'content', 'site.json');
  const worksFile = join(FIXTURE_ROOT, 'content', 'works.json');
  const site = JSON.parse(readFileSync(siteFile, 'utf8'));
  const works = JSON.parse(readFileSync(worksFile, 'utf8'));

  // Layout: contact first, about hidden, everything else after.
  const byId = Object.fromEntries(site.layout.sections.map((s) => [s.id, s]));
  site.layout.sections = [byId.contact, byId.hero, { ...byId.about, visible: false }, byId.grid, byId.featured];
  writeFileSync(siteFile, JSON.stringify(site, null, 2));

  // New work: one JSON entry plus a media file dropped into content/media.
  const template = works[0];
  cpSync(join(FIXTURE_ROOT, 'content', 'media', template.media.src), join(FIXTURE_ROOT, 'content', 'media', 'e2e-added-work.jpg'));
  works.push({
    ...template,
    ...ADDED_WORK,
    featured: false,
    order: 999,
    placeholder: false,
    media: { ...template.media, src: 'e2e-added-work.jpg', alt: 'E2E added work image' },
  });
  writeFileSync(worksFile, JSON.stringify(works, null, 2));

  const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  if (!existsSync(astro)) throw new Error(`astro CLI not found at ${astro}`);
  const result = spawnSync(process.execPath, [astro, 'build'], { cwd: FIXTURE_ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('fixture build failed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildFixture();
