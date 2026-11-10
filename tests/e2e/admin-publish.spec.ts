import { expect, test } from '@playwright/test';
import { mountAdmin, newBackend } from './admin-mock';

const run = (status: string, extra: object = {}) => ({ id: 'r1', status, requested_at: '2026-05-01T10:00:00Z', requested_by_name: 'Cesart', dispatched_at: null, finished_at: null, github_run_url: null, error: null, ...extra });

test('publish triggers the rebuild and follows the run to success (GitHub mocked)', async ({ page }) => {
  const backend = newBackend();
  // 1st poll: nothing yet. After the click: building, then succeeded.
  backend.runs = [[], [run('building')], [run('succeeded', { finished_at: '2026-05-01T10:02:00Z', github_run_url: 'https://github.com/example/actions/runs/1' })]];
  await mountAdmin(page, backend, '#/publish');

  await expect(page.getByText('Nothing has been published yet.')).toBeVisible();
  const button = page.getByRole('button', { name: 'Publish', exact: true });
  await button.click();

  await expect(page.getByText('Publish started')).toBeVisible();
  await expect(page.getByRole('status').getByText('Running')).toBeVisible();
  await expect(button).toBeDisabled();
  await expect(page.getByRole('status').getByText('Success')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('link', { name: 'Build log' })).toHaveAttribute('href', 'https://github.com/example/actions/runs/1');
  await expect(button).toBeEnabled();
  expect(backend.calls.filter((c) => c.name === 'publish' && c.method === 'POST')).toHaveLength(1);
});

test('a failed publish shows the error and keeps the button usable', async ({ page }) => {
  const backend = newBackend();
  backend.runs = [[run('failed', { error: 'Build exploded' })]];
  await mountAdmin(page, backend, '#/publish');

  await expect(page.getByRole('status').getByText('Failed')).toBeVisible();
  await expect(page.getByText('Build exploded').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeEnabled();
});

test('an in-flight run disables the publish button', async ({ page }) => {
  const backend = newBackend();
  backend.runs = [[run('dispatched')]];
  await mountAdmin(page, backend, '#/publish');

  await expect(page.getByRole('status').getByText('Queued')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish', exact: true })).toBeDisabled();
});
