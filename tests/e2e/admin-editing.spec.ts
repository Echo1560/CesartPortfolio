import { expect, test } from '@playwright/test';
import { draftTables, mountAdmin, newBackend } from './admin-mock';

function seeded() {
  const backend = newBackend();
  backend.tables = draftTables();
  return backend;
}

test('settings: site settings need a social share image', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/settings');
  const site = page.getByRole('region', { name: 'Site settings' });
  await site.getByRole('button', { name: 'Save site settings' }).click();
  await expect(site.getByText('Choose a social share image.')).toBeVisible();
  await expect(site.getByLabel('Page title')).not.toHaveAttribute('aria-invalid', 'true');
  expect(backend.writes).toEqual([]);
});

test('settings: saving site settings writes the SEO defaults as a draft', async ({ page }) => {
  const backend = seeded();
  backend.tables.media = [{ id: 'm-og', storage_path: 'library/og.png', kind: 'image', mime_type: 'image/png', bytes: 100, width: 1200, height: 630, default_alt: 'Share image', original_name: 'og.png', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', updated_by: null }];
  backend.tables.site![0]!['og_media_id'] = 'm-og';
  await mountAdmin(page, backend, '#/settings');
  const site = page.getByRole('region', { name: 'Site settings' });
  await site.getByLabel('Page title').fill('Cesart, illustrator');
  await site.getByRole('button', { name: 'Save site settings' }).click();
  await expect(page.getByText('Saved as draft')).toBeVisible();
  const write = backend.writes.find((w) => w.table === 'site' && w.method === 'PATCH' && 'meta_title' in w.body);
  expect(write?.body['meta_title']).toBe('Cesart, illustrator');
});

test('settings: the contact email must be valid and nothing is written otherwise', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/settings');
  const contact = page.getByRole('region', { name: 'Contact and social links' });
  await contact.getByLabel('Contact email').fill('nope');
  await contact.getByRole('button', { name: 'Save contact' }).click();
  await expect(contact.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  expect(backend.writes).toEqual([]);
});

test('settings: a valid contact email and a new social link are saved', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/settings');
  const contact = page.getByRole('region', { name: 'Contact and social links' });
  await contact.getByLabel('Contact email').fill('hello@example.com');
  await contact.getByRole('button', { name: 'Add social link' }).click();
  const n = await contact.getByRole('listitem').count();
  await contact.getByLabel(`Social ${n} label`).fill('Bluesky');
  await contact.getByLabel(`Social ${n} URL`).fill('https://bsky.app/profile/cesart');
  await contact.getByRole('button', { name: 'Save contact' }).click();
  await expect(page.getByText('Saved as draft')).toBeVisible();
  expect(backend.writes.find((w) => w.table === 'site' && w.method === 'PATCH')?.body).toEqual({ contact_email: 'hello@example.com' });
  const socials = backend.writes.filter((w) => w.table === 'socials' && w.method === 'POST').at(-1)!.body as { id: string }[];
  expect(socials.map((r) => r.id)).toContain('bluesky');
});

test('settings: the last category cannot be removed', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/settings');
  const cats = page.getByRole('region', { name: 'Categories' });
  await expect(cats.getByRole('button', { name: 'Remove' })).toHaveCount(2);
  while ((await cats.getByRole('button', { name: 'Remove' }).count()) > 0) await cats.getByRole('button', { name: 'Remove' }).first().click();
  await cats.getByRole('button', { name: 'Save categories' }).click();
  await expect(cats.getByText('Keep at least one category.')).toBeVisible();
  expect(backend.writes).toEqual([]);
});

test('works: the list shows every work and reordering persists sort_order', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/works');
  await expect(page.getByText('First work').first()).toBeVisible();
  await expect(page.getByText('Second work').first()).toBeVisible();
  await page.getByRole('button', { name: 'Move Second work up' }).click();
  await expect(page.getByText('Order saved as draft')).toBeVisible();
  const orders = Object.fromEntries(backend.writes.filter((w) => w.table === 'works').map((w) => [w.query['id']!.slice(3), w.body.sort_order]));
  expect(orders).toEqual({ 'second-work': 10, 'first-work': 20 });
});

test('works: a new work without a cover or alt text is refused and nothing is written', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/works/new');
  await page.getByLabel('Title').fill('Brand new');
  await page.getByRole('button', { name: 'Create work' }).click();
  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  expect(backend.writes.filter((w) => w.table === 'works')).toEqual([]);
});

test('works: deleting a work asks first and removes it', async ({ page }) => {
  const backend = seeded();
  const messages: string[] = [];
  page.on('dialog', (d) => {
    messages.push(d.message());
    void d.accept();
  });
  await mountAdmin(page, backend, '#/works');
  await page.getByRole('listitem').filter({ hasText: 'Second work' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Work deleted')).toBeVisible();
  expect(messages[0]).toContain('Second work');
  expect(backend.tables.works!.map((w) => w.id)).toEqual(['first-work']);
});

test('works: declining the delete confirmation keeps the work', async ({ page }) => {
  const backend = seeded();
  page.on('dialog', (d) => void d.dismiss());
  await mountAdmin(page, backend, '#/works');
  await page.getByRole('listitem').filter({ hasText: 'Second work' }).getByRole('button', { name: 'Delete' }).click();
  expect(backend.writes).toEqual([]);
});

test('media library: an empty library says so and offers upload', async ({ page }) => {
  await mountAdmin(page, seeded(), '#/media');
  await expect(page.getByText('The library is empty.')).toBeVisible();
  await expect(page.getByLabel('Upload files')).toBeAttached();
});

test('media library: an unsupported file type is rejected without touching storage', async ({ page }) => {
  const backend = seeded();
  let storageCalls = 0;
  await page.route('**/storage/v1/**', (r) => {
    storageCalls++;
    return r.fulfill({ status: 500, body: '{}' });
  });
  await mountAdmin(page, backend, '#/media');
  await page.getByLabel('Upload files').setInputFiles({ name: 'evil.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') });
  await expect(page.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  expect(storageCalls).toBe(0);
  expect(backend.writes.filter((w) => w.table === 'media')).toEqual([]);
});

test('activity: entries show who did what and the action filter narrows the query', async ({ page }) => {
  const backend = seeded();
  backend.tables.activity_log = [
    { id: 2, occurred_at: '2026-02-02T10:00:00Z', actor_name: 'Echo 1560', action: 'publish', table_name: 'publish_runs', row_id: null, details: {} },
    { id: 1, occurred_at: '2026-02-01T10:00:00Z', actor_name: 'Cesart', action: 'update', table_name: 'works', row_id: 'first-work', details: { changed: { title: { new: 'x' } } } },
  ];
  await mountAdmin(page, backend, '#/activity');
  await expect(page.getByRole('list').getByText('Echo 1560')).toBeVisible();
  await expect(page.getByText('Fields: title')).toBeVisible();
  await page.getByLabel('Action').selectOption('update');
  await expect(page.getByRole('list').getByText('Echo 1560')).toHaveCount(0);
  expect(backend.reads.some((r) => r.table === 'activity_log' && r.query['action'] === 'eq.update')).toBe(true);
});
