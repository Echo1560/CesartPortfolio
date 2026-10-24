import { expect, test } from '@playwright/test';
import { ADDED_WORK } from './build-fixture.mjs';

// Runs against a build of edited content: layout reordered, `about` hidden,
// and one extra works.json entry + media file. No source code differs.
const HOME = '/CesartPortfolio/';

test('visible:false hides a section and the layout order is applied', async ({ page }) => {
  await page.goto(HOME);
  await expect(page.locator('#about')).toHaveCount(0);
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('main > *')].map((el) => (el.matches('.hero') ? 'hero' : el.id)).filter((id) => id && id !== 'lightbox'),
  );
  expect(order).toEqual(['contact', 'hero', 'work', 'featured']);
});

test('a work added through content only gets a grid item', async ({ page }) => {
  await page.goto(HOME);
  const tile = page.locator(`[data-tile][data-slug="${ADDED_WORK.slug}"]`);
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('.tile__link')).toHaveAttribute('href', `${HOME}work/${ADDED_WORK.slug}/`);
});

test('a work added through content only gets a detail page', async ({ page }) => {
  const response = await page.goto(`${HOME}work/${ADDED_WORK.slug}/`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText(ADDED_WORK.title);
  await expect(page.locator('main img').first()).toBeVisible();
});
