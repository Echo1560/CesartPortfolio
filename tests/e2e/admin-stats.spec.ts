import { expect, test } from '@playwright/test';
import { mountAdmin, newBackend, type StatEvent } from './admin-mock';

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);
const ev = (d: number, name: string, visitor: string, extra: Partial<StatEvent> = {}): StatEvent => ({ day: day(d), name, visitor, device: 'desktop', ...extra });

test('stats shows totals, referrers and devices computed from seeded events', async ({ page }) => {
  const backend = newBackend();
  backend.events = [
    ev(1, 'page_view', 'a', { referrer_host: 'instagram.com' }),
    ev(1, 'page_view', 'b', { referrer_host: 'instagram.com', device: 'mobile' }),
    ev(2, 'page_view', 'a', { referrer_host: 'twitter.com' }),
    ev(2, 'work_open', 'a', { slug: 'dragon' }),
    ev(2, 'work_open', 'b', { slug: 'dragon' }),
    ev(3, 'video_play', 'b', { slug: 'dragon' }),
    ev(3, 'contact_click', 'b'),
  ];
  await mountAdmin(page, backend, '#/stats');

  const tile = (label: string) => page.locator('.tile', { has: page.getByText(label, { exact: true }) }).locator('dd');
  await expect(tile('Page views')).toHaveText('3');
  await expect(tile('Visitors')).toHaveText('2');
  await expect(tile('Work opens')).toHaveText('2');
  await expect(tile('Video plays')).toHaveText('1');
  await expect(tile('Contact clicks')).toHaveText('1');

  await expect(page.getByRole('row', { name: /instagram\.com/ })).toContainText('2');
  await expect(page.getByRole('row', { name: /twitter\.com/ })).toContainText('1');
  await expect(page.getByRole('row', { name: /Work dragon/ })).toContainText('2 opens · 1 plays');
  await expect(page.getByRole('row', { name: /mobile/ })).toContainText('1');
});

test('stats shows empty states when there are no events', async ({ page }) => {
  await mountAdmin(page, newBackend(), '#/stats');

  await expect(page.getByText('No page views in this range.')).toBeVisible();
  await expect(page.getByText('No events in this range.').first()).toBeVisible();
});

test('changing the range re-queries only that window', async ({ page }) => {
  const backend = newBackend();
  backend.events = [ev(1, 'page_view', 'a'), ev(20, 'page_view', 'b')];
  await mountAdmin(page, backend, '#/stats');

  const views = page.locator('.tile', { has: page.getByText('Page views', { exact: true }) }).locator('dd');
  await expect(views).toHaveText('2');
  await page.getByLabel('Date range').selectOption('7');
  await expect(views).toHaveText('1');
});

test('a custom range longer than 400 days is rejected without a request', async ({ page }) => {
  await mountAdmin(page, newBackend(), '#/stats');

  await page.getByLabel('Date range').selectOption('custom');
  await page.getByLabel('From').fill('2024-01-01');
  await page.getByLabel('To (inclusive)').fill('2026-01-01');
  await expect(page.getByText('Choose a valid range of at most 400 days.')).toBeVisible();
});
