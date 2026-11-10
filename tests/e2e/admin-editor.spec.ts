import { expect, test, type Page } from '@playwright/test';
import snapshot from '../fixtures/snapshot-v3.json' with { type: 'json' };
import { draftTables, mountAdmin, newBackend, type Backend } from './admin-mock';

const HOME = snapshot.pages[0]!;
const HERO = HOME.sections[0]!;

/** A backend whose `build_content_v3` answers from the fixture, overlaid with what the editor has saved. */
function seeded(): Backend {
  const backend = newBackend();
  backend.tables = {
    ...draftTables(),
    sections: HOME.sections.map((s, position) => ({ id: s.id, page_id: HOME.id, position, type: s.type, variant: s.variant, updated_at: '2026-01-01T00:00:00Z', updated_by: null })),
    blocks: [],
    pages: [],
  };
  backend.rpc['build_content_v3'] = () => {
    const saved = new Map(backend.tables['sections']!.map((r) => [r.id, r]));
    return {
      ...snapshot,
      pages: snapshot.pages.map((p) => ({
        ...p,
        sections: p.sections.map((s) => {
          const row = saved.get(s.id);
          return row?.content ? { ...s, content: { ...s.content, ...row.content }, settings: { ...s.settings, ...row.settings }, variant: row.variant ?? s.variant } : s;
        }),
      })),
    };
  };
  return backend;
}

const canvas = (page: Page) => page.frameLocator('iframe[title="Page canvas"]');
/** Waits until the editor has written `n` section updates and is idle. */
async function saved(page: Page, backend: Backend, n = 1) {
  await expect.poll(() => sectionWrites(backend).length).toBeGreaterThanOrEqual(n);
  await expect(page.locator('.editor__save')).toHaveText('All changes saved');
}
const sectionWrites = (backend: Backend) => backend.writes.filter((w) => w.table === 'sections' && w.method === 'PATCH');

test('the editor opens the draft page in the canvas, rendered by the shared components', async ({ page }) => {
  await mountAdmin(page, seeded());
  await expect(canvas(page).locator('.hero__title')).toHaveText('Cesart');
  await expect(page.getByRole('combobox', { name: 'Page' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('editing a heading inline autosaves, survives a reload and Publish dispatches', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  const title = canvas(page).locator('.hero__title');
  await title.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('Cesart Studio');
  await page.keyboard.press('Escape');
  await saved(page, backend);
  const write = sectionWrites(backend).at(-1)!;
  expect(write.query['id']).toBe(`eq.${HERO.id}`);
  expect((write.body as { content: { heading: unknown } }).content.heading).toEqual([{ type: 'text', text: 'Cesart Studio' }]);

  await page.reload();
  await expect(canvas(page).locator('.hero__title')).toHaveText('Cesart Studio');

  await page.getByRole('button', { name: 'Publish' }).click();
  await expect.poll(() => backend.calls.map((c) => c.name)).toContain('publish');
});

test('bold text is stored as a mark, never as HTML', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  const sub = canvas(page).locator('.hero__sub');
  await sub.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type('plain ');
  await page.keyboard.press('Control+B');
  await page.keyboard.type('strong');
  await page.keyboard.press('Escape');
  await saved(page, backend);
  
  const body = sectionWrites(backend).at(-1)!.body as { content: { subheading: unknown } };
  expect(body.content.subheading).toEqual([{ type: 'text', text: 'plain ' }, { type: 'text', text: 'strong', marks: [{ type: 'bold' }] }]);
  expect(JSON.stringify(body)).not.toContain('<');
});

test('clicking selects, the panel edits settings, and Escape deselects', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  await canvas(page).locator('[data-section-type="hero"]').click({ position: { x: 5, y: 5 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await expect(panel.getByRole('heading', { name: 'Hero section' })).toBeVisible();
  await expect(panel.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  await panel.getByLabel('Layout variant').selectOption('overlay');
  await expect(canvas(page).locator('.sec--hero-overlay')).toBeVisible();
  await saved(page, backend);
  expect((sectionWrites(backend).at(-1)!.body as { variant: string }).variant).toBe('overlay');
  await page.keyboard.press('Escape');
  await expect(panel.getByRole('heading', { name: 'Hero section' })).toHaveCount(0);
});

test('undo and redo walk back through edits', async ({ page }) => {
  await mountAdmin(page, seeded());
  await canvas(page).locator('[data-section-type="hero"]').click({ position: { x: 5, y: 5 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await panel.getByLabel('Layout variant').selectOption('split');
  await expect(canvas(page).locator('.sec--hero-split')).toBeVisible();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(canvas(page).locator('.sec--hero-default')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(canvas(page).locator('.sec--hero-split')).toBeVisible();
});

test('the device toggle resizes the canvas', async ({ page }) => {
  await mountAdmin(page, seeded());
  await page.getByRole('button', { name: 'Mobile width' }).click();
  await expect.poll(async () => (await page.locator('.canvas__frame').boundingBox())?.width).toBeLessThanOrEqual(390);
});

test('the account menu keeps the other dashboard views reachable', async ({ page }) => {
  await mountAdmin(page, seeded());
  await page.getByText('Account', { exact: true }).click();
  for (const name of ['Media library', 'Stats', 'Activity', 'Accounts']) await expect(page.locator('.editor__menu-list').getByRole('link', { name })).toBeVisible();
});

test('a change by another editor since load shows a notice (last write wins)', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  const row = backend.tables['sections']!.find((r) => r['id'] === HERO.id)!;
  row['updated_at'] = '2026-02-02T00:00:00Z';
  row['updated_by'] = '00000000-0000-4000-8000-000000000009';
  await canvas(page).locator('.hero__title').click();
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');

  await expect(page.getByRole('alert').filter({ hasText: 'changed this page since you opened it' })).toBeVisible();
  await saved(page, backend);
});
