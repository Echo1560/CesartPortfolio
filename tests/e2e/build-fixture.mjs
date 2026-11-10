// Builds a throwaway copy of the site whose content/ is edited, to prove that
// layout and works are data-driven: no source file is touched, only content.
// Output: .e2e-fixture/dist, served under /CesartPortfolio/ by `astro preview`.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURE_ROOT = join(root, '.e2e-fixture');

/** Animated works: one with WebM/MP4 variants next to the GIF, one with the GIF only. */
export const ANIMATED_WORKS = {
  withVariants: { slug: 'e2e-anim-video', title: 'E2E Animated Video', src: 'e2e-anim-video.gif' },
  gifOnly: { slug: 'e2e-anim-gif', title: 'E2E Animated GIF', src: 'e2e-anim-gif.gif' },
};

/** Slug and media file of the work added with content only (no code change). */
export const ADDED_WORK = { id: 'e2e-added-work', slug: 'e2e-added-work', title: 'E2E Added Work' };

/** Theme edit baked into the fixture: accent colour and heading font (what the Site styles panel writes). */
export const THEME_EDIT = { accent: '#7a2e8e', headingFont: 'lora' };

/** Second page: heading and rich-text blocks, one of them with markup-looking text that must be escaped. */
export const JOURNAL_PAGE = {
  id: '5a1c2b3d-0000-4000-8000-0000000000a1',
  slug: 'journal',
  title: 'Journal',
  status: 'published',
  isHome: false,
  seo: { title: 'Journal — E2E', description: 'E2E journal page description' },
  sections: [
    {
      id: '5a1c2b3d-0000-4000-8000-0000000000b1',
      type: 'text',
      variant: 'default',
      settings: { anchor: 'notes' },
      content: {},
      visibility: { desktop: true, tablet: true, mobile: true },
      blocks: [
        { id: '5a1c2b3d-0000-4000-8000-0000000000c1', type: 'heading', column: 0, settings: {}, content: { level: 1, text: [{ type: 'text', text: 'Journal heading' }] }, visibility: { desktop: true, tablet: true, mobile: true } },
        {
          id: '5a1c2b3d-0000-4000-8000-0000000000c2',
          type: 'paragraph',
          column: 0,
          settings: {},
          content: {
            text: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [
                    { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
                    { type: 'text', text: '<script>window.__pwned = true</script> & friends' },
                  ],
                },
              ],
            },
          },
          visibility: { desktop: true, tablet: true, mobile: true },
        },
      ],
    },
  ],
};

export const HIDDEN_PAGE = { ...JOURNAL_PAGE, id: '5a1c2b3d-0000-4000-8000-0000000000a2', slug: 'secret', title: 'Secret', status: 'hidden', sections: [] };

export function buildFixture() {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(FIXTURE_ROOT, { recursive: true });
  for (const entry of ['src', 'public', 'scripts', 'content', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
    cpSync(join(root, entry), join(FIXTURE_ROOT, entry), { recursive: true });
  }
  symlinkSync(join(root, 'node_modules'), join(FIXTURE_ROOT, 'node_modules'), 'junction');

  // The public site renders content/snapshot-v3.json (the v3 snapshot). Edit that copy only.
  const snapshotFile = join(FIXTURE_ROOT, 'content', 'snapshot-v3.json');
  const snapshot = JSON.parse(readFileSync(snapshotFile, 'utf8'));
  const works = snapshot.works;

  // Layout: contact first, about hidden, everything else after.
  const home = snapshot.pages.find((p) => p.isHome);
  const byType = (type) => home.sections.find((s) => s.type === type);
  home.sections = [byType('contact'), byType('hero'), byType('gallery'), byType('cta'), byType('featured')];

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

  // Animated works. Media files are tiny fixtures from tests/fixtures/media.
  const mediaDir = join(FIXTURE_ROOT, 'content', 'media');
  const fixtures = join(root, 'tests', 'fixtures', 'media');
  cpSync(join(mediaDir, template.media.src), join(mediaDir, 'e2e-anim-poster.jpg'));
  cpSync(join(fixtures, 'anim.gif'), join(mediaDir, ANIMATED_WORKS.withVariants.src));
  cpSync(join(fixtures, 'anim.webm'), join(mediaDir, 'e2e-anim-video.webm'));
  cpSync(join(fixtures, 'anim.mp4'), join(mediaDir, 'e2e-anim-video.mp4'));
  cpSync(join(fixtures, 'anim.gif'), join(mediaDir, ANIMATED_WORKS.gifOnly.src));
  Object.values(ANIMATED_WORKS).forEach(({ slug, title, src }, i) => {
    works.push({
      ...template,
      id: slug,
      slug,
      title,
      featured: false,
      order: 1000 + i,
      placeholder: false,
      media: { type: 'animated', src, poster: 'e2e-anim-poster.jpg', alt: `${title} loop`, width: 64, height: 64, loop: true },
    });
  });

  // A second page, in the nav, plus a hidden page that must not be emitted.
  snapshot.pages.push(JOURNAL_PAGE, HIDDEN_PAGE);
  snapshot.site.nav.items.push({ id: 'journal', label: 'Journal', link: { kind: 'page', pageId: JOURNAL_PAGE.id } });
  snapshot.theme.tokens.colors.light.accent = THEME_EDIT.accent;
  snapshot.theme.tokens.typography.headingFont = THEME_EDIT.headingFont;
  writeFileSync(snapshotFile, JSON.stringify(snapshot, null, 2));

  const astro = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs');
  if (!existsSync(astro)) throw new Error(`astro CLI not found at ${astro}`);
  const result = spawnSync(process.execPath, [astro, 'build'], { cwd: FIXTURE_ROOT, stdio: 'inherit' });
  if (result.status !== 0) throw new Error('fixture build failed');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) buildFixture();
