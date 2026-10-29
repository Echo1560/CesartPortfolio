import { expect, test } from '@playwright/test';
import { mountAdmin, newBackend } from './admin-mock';

test('an owner invites an editor and sees them in the list', async ({ page }) => {
  const backend = newBackend();
  await mountAdmin(page, backend, '#/accounts');
  await expect(page.getByText('cesart@example.com', { exact: false })).toBeVisible();

  await page.getByLabel('Email', { exact: true }).fill('ana@example.com');
  await page.getByLabel('Display name').fill('Ana');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  await expect(page.getByText('Invitation sent')).toBeVisible();
  expect(backend.calls.find((c) => c.name === 'invite-editor')?.body).toEqual({ email: 'ana@example.com', display_name: 'Ana' });
  await expect(page.getByText('ana@example.com', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove Ana' })).toBeVisible();
  // The owner cannot disable or remove their own account.
  await expect(page.getByRole('button', { name: /Remove Cesart/ })).toHaveCount(0);
});

test('inviting with an invalid email shows a field error and calls nothing', async ({ page }) => {
  const backend = newBackend();
  await mountAdmin(page, backend, '#/accounts');

  await page.getByLabel('Email', { exact: true }).fill('not-an-email');
  await page.getByLabel('Display name').fill('Ana');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  expect(backend.calls.filter((c) => c.name === 'invite-editor')).toHaveLength(0);
});

test('a server refusal (already an editor) is shown as an error', async ({ page }) => {
  const backend = newBackend();
  backend.fn['invite-editor'] = () => ({ status: 409, json: { ok: false, error: { code: 'conflict', message: 'That email is already an editor.' } } });
  await mountAdmin(page, backend, '#/accounts');

  await page.getByLabel('Email', { exact: true }).fill('cesart@example.com');
  await page.getByLabel('Display name').fill('Dup');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  await expect(page.getByRole('alert').filter({ hasText: 'That email is already an editor.' })).toBeVisible();
});
