import { expect, test } from '@playwright/test';
import { draftTables, mountAdmin, newBackend } from './admin-mock';

test('without a session /admin shows only the login form', async ({ page }) => {
  await mountAdmin(page, newBackend(), '', { signedIn: false });
  await expect(page.getByRole('heading', { name: 'Dashboard login' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);
});

test('the login form offers no sign-up path', async ({ page }) => {
  await mountAdmin(page, newBackend(), '', { signedIn: false });
  await expect(page.getByRole('heading', { name: 'Dashboard login' })).toBeVisible();
  await expect(page.getByText(/sign[ -]?up|register|create (an )?account/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /sign[ -]?up|register/i })).toHaveCount(0);
});

test('the admin page is noindex,nofollow', async ({ page }) => {
  await mountAdmin(page, newBackend(), '', { signedIn: false });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /nofollow/);
});

test('wrong credentials show an error and keep the form', async ({ page }) => {
  const backend = newBackend();
  await mountAdmin(page, backend, '', { signedIn: false });
  await page.getByLabel('Email').fill('cesart@example.com');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard login' })).toBeVisible();
  expect(backend.auth).toContain('token');
});

test('a malformed login is rejected before any request', async ({ page }) => {
  const backend = newBackend();
  await mountAdmin(page, backend, '', { signedIn: false });
  await page.getByLabel('Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByText('Enter a valid email address')).toBeVisible();
  expect(backend.auth).not.toContain('token');
});

test('a valid login opens the dashboard', async ({ page }) => {
  const backend = newBackend();
  backend.tables = draftTables();
  backend.login = (email, password) => (email === 'cesart@example.com' && password === 'correct-horse-battery' ? null : 'Invalid login credentials');
  await mountAdmin(page, backend, '', { signedIn: false });
  await page.getByLabel('Email').fill('cesart@example.com');
  await page.getByLabel('Password').fill('correct-horse-battery');
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByLabel('Password')).toHaveCount(0);
});

test('a signed-in user who is not an active editor is sent back to the login form', async ({ page }) => {
  const backend = newBackend();
  backend.tables = draftTables();
  backend.isEditor = false;
  await mountAdmin(page, backend);
  await expect(page.getByRole('heading', { name: 'Dashboard login' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Dashboard sections' })).toHaveCount(0);
  await expect.poll(() => backend.auth).toContain('logout');
});

// Known bug (child issue of TITA-76): boot() and the INITIAL_SESSION auth event both run route(); the
// second run re-renders the login form after the first consumed `loginMessage`, so the notice is lost.
test('a non-editor is told why they were refused', async ({ page }) => {
  const backend = newBackend();
  backend.tables = draftTables();
  backend.isEditor = false;
  await mountAdmin(page, backend);
  await expect(page.getByText('This account does not have dashboard access.')).toBeVisible();
});

test('logging out returns to the login form', async ({ page }) => {
  const backend = newBackend();
  backend.tables = draftTables();
  await mountAdmin(page, backend, '#/settings');
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard login' })).toBeVisible();
});

test('the dashboard exposes every section in its navigation', async ({ page }) => {
  const backend = newBackend();
  backend.tables = draftTables();
  await mountAdmin(page, backend, '#/settings');
  const nav = page.getByRole('navigation', { name: 'Dashboard sections' });
  for (const name of ['Visual editor', 'Pages', 'Works', 'Settings', 'Media library', 'Publish', 'Stats', 'Accounts', 'Activity']) {
    await expect(nav.getByRole('link', { name, exact: true })).toBeVisible();
  }
  // The v2 form pages are retired: the visual editor replaces them.
  for (const name of ['Content', 'Layout', 'Preview']) await expect(nav.getByRole('link', { name, exact: true })).toHaveCount(0);
});
