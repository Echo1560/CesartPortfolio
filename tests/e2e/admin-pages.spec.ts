import { expect, test } from '@playwright/test';
import { siteNavSchema } from '../../src/lib/schema-v3';
import { draftTables, mountAdmin, newBackend, type Backend } from './admin-mock';

const HOME_ID = '00000000-0000-4000-8000-0000000000a1';
const STAMP = { updated_at: '2026-01-01T00:00:00Z', updated_by: null };

/** A draft with a home page, an empty menu and an empty footer. */
function seeded(): Backend {
  const backend = newBackend();
  backend.tables = {
    ...draftTables(),
    site: [{ ...draftTables()['site']![0]!, nav: { items: [] }, footer: { links: [], showSocials: true, showCopyright: true, showBackToTop: false } }],
    pages: [{ id: HOME_ID, slug: 'home', title: 'Home', seo_title: null, seo_description: null, social_media_id: null, status: 'published', is_home: true, position: 0, ...STAMP }],
    sections: [],
    blocks: [],
  };
  return backend;
}

test('a page created from a template is saved with its sections and added to the menu', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Start from').selectOption('commissions');
  await expect(dialog.getByLabel('Page title')).toHaveValue('Commissions');
  await expect(dialog.getByLabel('Address (slug)')).toHaveValue('commissions');
  await dialog.getByRole('button', { name: 'Create page' }).click();

  await expect(page).toHaveURL(/#\/editor\/commissions$/);

  const created = backend.tables['pages']!.find((p) => p['slug'] === 'commissions')!;
  expect(created).toMatchObject({ title: 'Commissions', status: 'published', position: 1 });

  const sections = backend.tables['sections']!.filter((s) => s['page_id'] === created['id']);
  expect(sections.length).toBeGreaterThan(0);
  expect(sections.map((s) => s['position'])).toEqual(sections.map((_, i) => i));

  const nav = backend.tables['site']![0]!['nav'];
  expect(siteNavSchema.safeParse(nav).success).toBe(true);
  expect(nav.items).toEqual([expect.objectContaining({ label: 'Commissions', link: { kind: 'page', pageId: created['id'] } })]);
});

test('a duplicate address is refused and nothing is written', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Page title').fill('Another');
  await dialog.getByLabel('Address (slug)').fill('home');
  await dialog.getByRole('button', { name: 'Create page' }).click();

  await expect(dialog.getByText('Another page already uses this address.')).toBeVisible();
  expect(backend.writes).toEqual([]);
});

test('a reserved address is refused', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'New page' }).click();
  const dialog = page.getByRole('dialog', { name: 'New page' });
  await dialog.getByLabel('Page title').fill('Admin');
  await dialog.getByLabel('Address (slug)').fill('admin');
  await dialog.getByRole('button', { name: 'Create page' }).click();

  await expect(dialog).toBeVisible();
  expect(backend.writes.filter((w) => w.table === 'pages')).toEqual([]);
});

test('the home page cannot be deleted from the list', async ({ page }) => {
  await mountAdmin(page, seeded(), '#/pages');
  await expect(page.getByRole('button', { name: 'Delete Home' })).toBeDisabled();
});

const NEWS_ID = '00000000-0000-4000-8000-0000000000a2';

/** The seeded draft plus a "News" page that is linked from the menu. */
function withNews(): Backend {
  const backend = seeded();
  backend.tables['pages']!.push({ id: NEWS_ID, slug: 'news', title: 'News', seo_title: null, seo_description: null, social_media_id: null, status: 'published', is_home: false, position: 1, ...STAMP });
  backend.tables['site']![0]!['nav'] = { items: [{ label: 'News', link: { kind: 'page', pageId: NEWS_ID } }] };
  return backend;
}

test('deleting a page asks first, removes it and drops its menu link', async ({ page }) => {
  const backend = withNews();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'Delete News' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete page' }).click();

  await expect(page.locator('[data-page="news"]')).toHaveCount(0);
  expect(backend.tables['pages']!.map((p) => p['slug'])).toEqual(['home']);
  expect(backend.tables['site']![0]!['nav']).toEqual({ items: [] });
});

test('declining the page delete confirmation keeps the page and writes nothing', async ({ page }) => {
  const backend = withNews();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'Delete News' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();

  await expect(page.locator('[data-page="news"]')).toBeVisible();
  expect(backend.writes).toEqual([]);
});

test('making a page the home page calls set_home_page after confirmation', async ({ page }) => {
  const backend = withNews();
  const calls: unknown[] = [];
  backend.rpc['set_home_page'] = (args) => {
    calls.push(args);
    return null;
  };
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'Make News the home page' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Make home page' }).click();

  await expect.poll(() => calls).toEqual([{ p_page_id: NEWS_ID }]);
});

test('duplicating a page adds a copy with its own address', async ({ page }) => {
  const backend = withNews();
  await mountAdmin(page, backend, '#/pages');

  await page.getByRole('button', { name: 'Duplicate News' }).click();

  await expect.poll(() => backend.tables['pages']!.length).toBe(3);
  const slugs = backend.tables['pages']!.map((p) => p['slug']);
  expect(new Set(slugs).size).toBe(3);
});
