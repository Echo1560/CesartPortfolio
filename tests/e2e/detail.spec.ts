import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const HOME = '/CesartPortfolio/';
const works: { slug: string; title: string }[] = JSON.parse(readFileSync('content/works.json', 'utf8'));
const first = works[0];

test('direct load of /work/<slug>/ works', async ({ page }) => {
  const response = await page.goto(`${HOME}work/${first.slug}/`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText(first.title);
  await expect(page.locator('main img').first()).toBeVisible();
});

test('every work has a statically generated detail page', async ({ request }) => {
  for (const w of works) {
    const response = await request.get(`${HOME}work/${w.slug}/`);
    expect(response.status(), w.slug).toBe(200);
  }
});

test('unknown routes serve the 404 page', async ({ page }) => {
  await page.goto(`${HOME}does-not-exist/`);
  await expect(page.locator('h1').first()).toBeVisible();
});

test('root-relative links on the detail page include the base path', async ({ page }) => {
  await page.goto(`${HOME}work/${first.slug}/`);
  const hrefs = await page.locator('a[href^="/"]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));
  for (const href of hrefs) expect(href).toMatch(/^\/CesartPortfolio\//);
});
