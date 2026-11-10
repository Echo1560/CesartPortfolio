import { expect, test } from '@playwright/test';

// Public visitors must never be offered a login or a link to the dashboard.
const hrefsOf = (page: import('@playwright/test').Page) => page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''));

for (const path of ['/CesartPortfolio/', '/CesartPortfolio/404.html']) {
  test(`${path} has no login, sign-up or admin link`, async ({ page }) => {
    await page.goto(path);
    expect((await hrefsOf(page)).filter((h) => /admin/i.test(h))).toEqual([]);
    await expect(page.getByRole('link', { name: /log ?in|sign ?in|sign ?up|admin|dashboard/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /log ?in|sign ?in|sign ?up/i })).toHaveCount(0);
  });
}

test('a work detail page has no admin link either', async ({ page, request }) => {
  const home = await (await request.get('/CesartPortfolio/')).text();
  const detail = home.match(/href="(\/CesartPortfolio\/work\/[^"]+)"/)?.[1];
  expect(detail).toBeTruthy();
  await page.goto(detail!);
  expect((await hrefsOf(page)).filter((h) => /admin/i.test(h))).toEqual([]);
});

test('robots.txt disallows the dashboard', async ({ request }) => {
  const res = await request.get('/CesartPortfolio/robots.txt');
  expect(res.ok()).toBe(true);
  expect(await res.text()).toMatch(/Disallow:\s*\/CesartPortfolio\/admin\//);
});

test('the public pages are not marked noindex', async ({ page }) => {
  await page.goto('/CesartPortfolio/');
  await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
});
