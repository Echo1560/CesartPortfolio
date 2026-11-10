import { expect, test, type Page } from '@playwright/test';
import snapshot from '../fixtures/snapshot-v3.json' with { type: 'json' };
import { draftTables, mountAdmin, newBackend, type Backend } from './admin-mock';

const HOME = snapshot.pages[0]!;

/** A backend whose draft has a `theme` row, so the editor can load and write it. */
function seeded(): Backend {
  const backend = newBackend();
  backend.tables = {
    ...draftTables(),
    sections: HOME.sections.map((s, position) => ({ id: s.id, page_id: HOME.id, position, type: s.type, variant: s.variant, updated_at: '2026-01-01T00:00:00Z', updated_by: null })),
    blocks: [],
    pages: [],
    theme: [{ id: 1, preset: snapshot.theme.preset, tokens: snapshot.theme.tokens, updated_at: '2026-01-01T00:00:00Z', updated_by: null }],
  };
  backend.rpc['build_content_v3'] = () => snapshot;
  return backend;
}

const themeWrites = (backend: Backend) => backend.writes.filter((w) => w.table === 'theme' && w.method === 'PATCH');
const canvas = (page: Page) => page.frameLocator('iframe[title="Page canvas"]');

async function openStyles(page: Page) {
  await page.getByRole('button', { name: 'Site styles' }).click();
  await expect(page.getByRole('heading', { name: 'Site styles' })).toBeVisible();
}

test('changing the accent colour and heading font previews live, autosaves to the theme row and publishes', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  await openStyles(page);

  await page.getByRole('textbox', { name: 'Accent hex value' }).first().fill('#7a2e8e');
  await page.getByRole('combobox', { name: 'Heading font' }).selectOption('lora');

  // Live preview: the canvas document carries the new variables.
  await expect.poll(() => canvas(page).locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--color-accent').trim())).toBe('#7a2e8e');
  await expect.poll(() => canvas(page).locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--font-display'))).toContain('Lora');

  // Autosave: one row, id = 1, with the edited tokens.
  await expect(page.locator('.editor__save')).toHaveText('All changes saved');
  const last = themeWrites(backend).at(-1)!;
  expect(last.query['id']).toBe('eq.1');
  expect(last.body.tokens.colors.light.accent).toBe('#7a2e8e');
  expect(last.body.tokens.typography.headingFont).toBe('lora');

  // Publish dispatches the rebuild that bakes the theme into the CSS.
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect.poll(() => backend.calls.filter((c) => c.name === 'publish' && c.method === 'POST').length).toBe(1);
});

test('a low-contrast colour shows a WCAG warning and a fixed colour clears it', async ({ page }) => {
  await mountAdmin(page, seeded());
  await openStyles(page);
  const warning = page.locator('.styles__warn').first();
  await expect(warning).toBeHidden();

  await page.getByRole('textbox', { name: 'Text hex value' }).first().fill('#f0ede6');
  await expect(warning).toContainText('Low contrast');

  await page.getByRole('textbox', { name: 'Text hex value' }).first().fill('#1b1a17');
  await expect(warning).toBeHidden();
});

test('picking a preset applies its tokens; Undo and Reset to default restore the original', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend);
  await openStyles(page);
  const accent = () => canvas(page).locator('html').evaluate((el) => getComputedStyle(el).getPropertyValue('--color-accent').trim());
  const original = await accent();

  await page.locator('[data-preset="noir"]').click();
  await expect(page.locator('[data-preset="noir"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(accent).not.toBe(original);
  await expect.poll(() => themeWrites(backend).at(-1)?.body.preset).toBe('noir');

  await page.getByRole('button', { name: 'Undo style change' }).click();
  await expect.poll(accent).toBe(original);

  await page.locator('[data-preset="citrus"]').click();
  await page.locator('[data-action="reset-default"]').click();
  await expect.poll(accent).toBe(original);
  await expect(page.locator('[data-preset="classic"]')).toHaveAttribute('aria-pressed', 'true');
});
