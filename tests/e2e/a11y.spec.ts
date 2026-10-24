import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const HOME = '/CesartPortfolio/';
const works: { slug: string }[] = JSON.parse(readFileSync('content/works.json', 'utf8'));

async function blocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}]`);
}

test('home: no serious or critical axe violations (incl. color-contrast)', async ({ page }) => {
  await page.goto(HOME);
  expect(await blocking(page)).toEqual([]);
});

test('detail: no serious or critical axe violations (incl. color-contrast)', async ({ page }) => {
  await page.goto(`${HOME}work/${works[0].slug}/`);
  expect(await blocking(page)).toEqual([]);
});

test('home with lightbox open: no serious or critical axe violations', async ({ page }) => {
  await page.goto(HOME);
  await page.locator('[data-work-grid] .tile__link').first().click();
  await expect(page.locator('[data-lightbox]')).toBeVisible();
  expect(await blocking(page)).toEqual([]);
});
