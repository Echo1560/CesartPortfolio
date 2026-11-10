import { expect, test } from '@playwright/test';
import { draftTables, mountAdmin, newBackend } from './admin-mock';

function seeded() {
  const backend = newBackend();
  backend.tables = draftTables();
  return backend;
}

test('content: saving About writes the heading and Markdown body as a draft', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/content');
  const about = page.getByRole('region', { name: 'About' });
  await about.getByLabel('Heading').fill('About Cesart');
  await about.getByLabel('Text (Markdown)').fill('Hello **world**');
  await expect(about.frameLocator('iframe[title="Markdown preview"]').locator('strong')).toHaveText('world');
  await about.getByRole('button', { name: 'Save about' }).click();
  await expect(page.getByText('Saved as draft')).toBeVisible();
  const write = backend.writes.find((w) => w.table === 'site' && w.method === 'PATCH' && 'about_heading' in w.body);
  expect(write?.body).toEqual({ about_heading: 'About Cesart', about_body: 'Hello **world**' });
});

test('content: contact needs a valid email and writes nothing otherwise', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/content');
  const contact = page.getByRole('region', { name: 'Contact' });
  await contact.getByLabel('Email', { exact: true }).fill('nope');
  await contact.getByRole('button', { name: 'Save contact' }).click();
  await expect(contact.getByRole('alert').filter({ hasText: /./ }).first()).toBeVisible();
  expect(backend.writes).toEqual([]);
});

test('layout: hiding a section and reordering are saved to the layout table', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/layout');
  await page.getByLabel('About visible').uncheck();
  await page.getByRole('button', { name: 'Move Work grid up' }).click();
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Saved as draft')).toBeVisible();
  const rows = backend.writes.find((w) => w.table === 'layout')!.body as { section_id: string; position: number; visible: boolean }[];
  expect(rows.map((r) => r.section_id)).toEqual(['hero', 'grid', 'featured', 'about', 'contact']);
  expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3, 4]);
  expect(rows.find((r) => r.section_id === 'about')?.visible).toBe(false);
});

test('layout: featured works can be added and are saved in order', async ({ page }) => {
  const backend = seeded();
  await mountAdmin(page, backend, '#/layout');
  await page.getByLabel('Add a featured work').selectOption('second-work');
  await page.getByRole('button', { name: 'Save layout' }).click();
  await expect(page.getByText('Saved as draft')).toBeVisible();
  const last = backend.writes.filter((w) => w.table === 'layout_featured_works' && w.method === 'POST').at(-1)!;
  expect((last.body as { work_id: string }[]).map((r) => r.work_id)).toEqual(['first-work', 'second-work']);
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
