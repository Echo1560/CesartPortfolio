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

test('markup that lands in the canvas is saved as JSON: unsafe links and tags are dropped', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  const about = HOME.sections.find((s) => s.type === 'about')!;
  const prose = canvas(page).locator(`[data-section-id="${about.id}"] .prose`);
  await prose.click();
  // Whatever the browser or an extension puts into the editable DOM goes through richOf().
  await page.evaluate((id) => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Page canvas"]')!;
    const el = frame.contentDocument!.querySelector<HTMLElement>(`[data-section-id="${id}"] .prose`)!;
    el.innerHTML =
      '<p>ok <a href="https://example.com/a">safe</a> <a href="javascript:alert(1)">js</a> <a href="//evil.example">proto</a>' +
      '<img src="x" onerror="alert(1)"><script>alert(1)</script></p><iframe src="https://evil.example"></iframe>';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, about.id);
  await page.keyboard.press('Escape');
  await expect.poll(() => sectionWrites(backend).filter((w) => w.query['id'] === `eq.${about.id}`).length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.editor__save')).toHaveText('All changes saved');

  const body = sectionWrites(backend).filter((w) => w.query['id'] === `eq.${about.id}`).at(-1)!.body as { content: { body: unknown } };
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/javascript:|evil\.example|onerror|<img|<script|<iframe/i);
  expect(json).toContain('"href":"https://example.com/a"');
  expect(json).not.toContain('<');
  await expect(canvas(page).locator('script, iframe, img[onerror], a[href^="javascript"]')).toHaveCount(0);
});

test('pasting HTML into the canvas inserts plain text only', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  const sub = canvas(page).locator('.hero__sub');
  await sub.click();
  await page.keyboard.press('Control+A');
  await page.evaluate(() => {
    const doc = document.querySelector<HTMLIFrameElement>('iframe[title="Page canvas"]')!.contentDocument!;
    const dt = new DataTransfer();
    dt.setData('text/html', '<a href="javascript:alert(1)">evil</a><img src=x onerror=alert(1)>');
    dt.setData('text/plain', 'pasted text');
    doc.querySelector('.hero__sub')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.keyboard.press('Escape');
  await saved(page, backend);
  const body = sectionWrites(backend).at(-1)!.body as { content: { subheading: unknown } };
  expect(body.content.subheading).toEqual([{ type: 'text', text: 'pasted text' }]);
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

test('clearing alt text with no library default is refused and nothing is written', async ({ page }) => {
  const backend = seeded();
  backend.tables['media'] = [{ id: HERO.content.media!.mediaId, storage_path: 'x.png', kind: 'image', mime_type: 'image/png', bytes: 1, width: 10, height: 10, default_alt: '', original_name: 'x.png', updated_at: 'x', updated_by: null }];
  await mountAdmin(page, backend);
  await canvas(page).locator('[data-section-type="hero"]').click({ position: { x: 5, y: 5 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await panel.getByLabel('Alt text').fill('');
  await expect(panel.getByText('Alt text is required')).toBeVisible();
  await page.waitForTimeout(1800);
  expect(sectionWrites(backend)).toEqual([]);
});

test('a video without a poster is refused at save', async ({ page }) => {
  const backend = seeded();
  const media = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
  delete (media.pages[0]!.sections[0]!.content.media as Record<string, unknown>)['posterId'];
  backend.rpc['build_content_v3'] = () => media;
  await mountAdmin(page, backend);
  await canvas(page).locator('.hero__title').click();
  await page.keyboard.type('!');
  await page.keyboard.press('Escape');
  await expect(page.locator('.editor__save')).toContainText('needs a poster', { timeout: 8000 });
  expect(sectionWrites(backend)).toEqual([]);
});
