import { expect, test, type Page } from '@playwright/test';
import snapshot from '../fixtures/snapshot-v3.json' with { type: 'json' };
import { snapshotV3Schema } from '../../src/lib/schema-v3';
import { draftTables, mountAdmin, newBackend, type Backend } from './admin-mock';

const HOME = snapshot.pages[0]!;
const HERO = HOME.sections[0]!;
const types = (b: Backend) => sectionRows(b).map((r) => r['type']);

type Row = Record<string, any>;
const sectionRows = (b: Backend): Row[] => [...b.tables['sections']!].filter((r) => r['page_id'] === HOME.id).sort((x, y) => x['position'] - y['position']);

/** Every media object of the fixture by id, to turn the editor's `{mediaId}` references back into snapshot media. */
const MEDIA = new Map<string, Row>();
(function collect(v: unknown) {
  if (Array.isArray(v)) return v.forEach(collect);
  if (typeof v !== 'object' || v === null) return;
  const o = v as Row;
  if (o['mediaId'] && o['src']) MEDIA.set(o['mediaId'], o);
  Object.values(o).forEach(collect);
})(snapshot);
const resolve = (v: any): any => {
  if (Array.isArray(v)) return v.map(resolve);
  if (typeof v !== 'object' || v === null) return v;
  if (v.mediaId && !v.src && MEDIA.has(v.mediaId)) return { ...MEDIA.get(v.mediaId), ...v };
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolve(x)]));
};

/** A backend whose sections and blocks tables hold the fixture home page, and whose `build_content_v3` reads them back. */
function live(): Backend {
  const backend = newBackend();
  const stamp = { updated_at: '2026-01-01T00:00:00Z', updated_by: null };
  const show = (v: { desktop: boolean; tablet: boolean; mobile: boolean }) => ({ show_on_desktop: v.desktop, show_on_tablet: v.tablet, show_on_mobile: v.mobile });
  backend.tables = {
    ...draftTables(),
    sections: HOME.sections.map((s, position) => ({ id: s.id, page_id: HOME.id, position, type: s.type, variant: s.variant, settings: s.settings, content: s.content, ...show(s.visibility), ...stamp })),
    blocks: [],
    pages: [],
    media: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', storage_path: 'e2e.png', kind: 'image', mime_type: 'image/png', bytes: 1, width: 10, height: 10, default_alt: 'E2E image', original_name: 'e2e.png', ...stamp }],
  };
  backend.rpc['build_content_v3'] = () => {
    const blocks = backend.tables['blocks']!;
    const sections = sectionRows(backend).map((r) => ({
      id: r['id'],
      type: r['type'],
      variant: r['variant'],
      settings: resolve(r['settings'] ?? {}),
      content: resolve(r['content'] ?? {}),
      visibility: { desktop: r['show_on_desktop'] ?? true, tablet: r['show_on_tablet'] ?? true, mobile: r['show_on_mobile'] ?? true },
      ...(['text', 'columns'].includes(r['type'])
        ? {
            blocks: blocks
              .filter((b) => b['section_id'] === r['id'])
              .sort((x, y) => x['column_index'] - y['column_index'] || x['position'] - y['position'])
              .map((b) => ({ id: b['id'], type: b['type'], column: b['column_index'], settings: b['settings'] ?? {}, content: resolve(b['content'] ?? {}), visibility: { desktop: b['show_on_desktop'] ?? true, tablet: b['show_on_tablet'] ?? true, mobile: b['show_on_mobile'] ?? true } })),
          }
        : {}),
    }));
    return { ...snapshot, pages: snapshot.pages.map((p, i) => (i === 0 ? { ...p, sections } : p)) };
  };
  return backend;
}

const canvas = (page: Page) => page.frameLocator('iframe[title="Page canvas"]');
const settled = (page: Page) => expect(page.locator('.editor__save')).toHaveText('All changes saved');
const order = (page: Page) => canvas(page).locator('main > [data-section-id]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset['sectionType']));

/** Opens the picker from the "+" before the first section (or at the end) and chooses a type. */
async function addSection(page: Page, label: RegExp | string, where: 'first' | 'end' = 'first') {
  const plus = canvas(page).getByRole('button', { name: where === 'first' ? /^Add a section before/ : 'Add a section at the end' }).first();
  await plus.click();
  const dialog = page.getByRole('dialog', { name: 'Add a section' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: label }).click();
}

test('the section picker lists every section type with a preview, and inserts the choice with default content', async ({ page }) => {
  const backend = live();
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  await canvas(page).getByRole('button', { name: 'Add a section at the end' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a section' });
  await expect(dialog.locator('.choice')).toHaveCount(11);
  await expect(dialog.locator('.choice svg.wire')).toHaveCount(11);
  await dialog.getByRole('button', { name: /Call to action/ }).click();
  await expect(canvas(page).locator('main > [data-section-type="cta"]')).toHaveCount(2);
  await settled(page);
  expect(types(backend).at(-1)).toBe('cta');
  const row = sectionRows(backend).at(-1)!;
  expect(row['position']).toBe(HOME.sections.length);
  expect(row['variant']).toBe('default');
  expect(JSON.stringify(row['content'])).toContain('Have a project in mind?');
});

test('a section is added from the picker, reordered by drag and by keyboard, changed, deleted and restored by undo; then published', async ({ page }) => {
  const backend = live();
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  const original = HOME.sections.map((s) => s.type);

  // add: a columns section before the hero
  await addSection(page, /^Columns/);
  await expect.poll(() => order(page)).toEqual(['columns', ...original]);
  await settled(page);
  expect(types(backend)).toEqual(['columns', ...original]);
  const columnsId = sectionRows(backend)[0]!['id'];
  expect(backend.tables['blocks']!.filter((b) => b['section_id'] === columnsId)).toHaveLength(2);

  // reorder by keyboard: the drag handle answers the arrow keys
  const handle = canvas(page).locator(`.ed-tb--section[data-for="${columnsId}"] [data-ed="drag"]`);
  await canvas(page).locator(`[data-section-id="${columnsId}"]`).hover();
  await handle.focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual([original[0], 'columns', ...original.slice(1)]);
  await settled(page);
  expect(types(backend).slice(0, 2)).toEqual([original[0], 'columns']);

  // reorder by drag: grab the handle and drop it below the gallery
  const target = canvas(page).locator('main > [data-section-type="gallery"]');
  await canvas(page).locator(`[data-section-id="${columnsId}"]`).hover();
  const box = (await canvas(page).locator(`.ed-tb--section[data-for="${columnsId}"] [data-ed="drag"]`).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await target.scrollIntoViewIfNeeded();
  const t = (await target.boundingBox())!;
  await page.mouse.move(box.x + 10, t.y + t.height - 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await order(page)).indexOf('columns')).toBe(original.indexOf('gallery') + 1);
  await settled(page);
  expect(types(backend)).toEqual(['hero', 'featured', 'gallery', 'columns', 'cta', 'about', 'contact']);

  // variant
  await canvas(page).locator(`[data-section-id="${columnsId}"]`).click({ position: { x: 4, y: 4 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await panel.getByLabel('Layout variant').selectOption('wide-left');
  await expect(canvas(page).locator('.sec--columns-wide-left')).toBeVisible();
  await settled(page);
  expect(sectionRows(backend).find((r) => r['id'] === columnsId)!['variant']).toBe('wide-left');

  // block into a column: the second column gets a quote
  await panel.getByRole('button', { name: 'Add a block to column 2' }).click();
  await page.getByRole('dialog', { name: 'Add a block' }).getByRole('button', { name: /^Quote/ }).click();
  await expect(canvas(page).locator(`[data-section-id="${columnsId}"] .columns__col:nth-child(2) blockquote`)).toBeVisible();
  await settled(page);
  const blocks = backend.tables['blocks']!.filter((b) => b['section_id'] === columnsId).sort((x, y) => x['column_index'] - y['column_index'] || x['position'] - y['position']);
  expect(blocks.map((b) => [b['type'], b['column_index']])).toEqual([['paragraph', 0], ['paragraph', 1], ['quote', 1]]);

  // delete, then undo
  const before = await order(page);
  await panel.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('button', { name: 'Columns' }).click();
  await panel.getByRole('button', { name: 'Delete Columns section' }).click();
  await expect.poll(() => order(page)).toEqual(before.filter((x) => x !== 'columns'));
  await settled(page);
  expect(types(backend)).not.toContain('columns');
  // (the database cascades the section's blocks; the mock does not, so only the section row is checked)
  expect(backend.writes.some((w) => w.table === 'sections' && w.method === 'DELETE')).toBe(true);
  await page.locator('.editor__flash').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => order(page)).toEqual(before);
  await settled(page);
  expect(types(backend)).toEqual(before);
  expect(backend.tables['blocks']!.filter((b) => b['section_id'] === columnsId)).toHaveLength(3);

  // publish: what the publish freezes (the draft the database builds) is a valid v3 snapshot that has the section
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect.poll(() => backend.calls.map((c) => c.name)).toContain('publish');
  const published = snapshotV3Schema.parse(backend.rpc['build_content_v3']!({}));
  const home = published.pages[0]!;
  expect(home.sections.map((s) => s.type)).toEqual(before);
  const columns = home.sections.find((s) => s.type === 'columns')!;
  expect(columns.variant).toBe('wide-left');
  expect((columns as { blocks: { type: string }[] }).blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'quote']);
});

test('keyboard: Alt+Arrow moves the selected section, and the panel buttons duplicate and delete it', async ({ page }) => {
  const backend = live();
  await mountAdmin(page, backend);
  await canvas(page).locator('[data-section-type="featured"]').click({ position: { x: 4, y: 4 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await expect(panel.getByRole('heading', { name: 'Featured section' })).toBeVisible();
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(() => order(page)).toEqual(['featured', 'hero', ...HOME.sections.slice(2).map((s) => s.type)]);
  await settled(page);
  expect(types(backend).slice(0, 2)).toEqual(['featured', 'hero']);

  await panel.getByRole('button', { name: 'Duplicate Featured section' }).click();
  await expect.poll(async () => (await order(page)).filter((x) => x === 'featured').length).toBe(2);
  await settled(page);
  expect(types(backend).filter((x) => x === 'featured')).toHaveLength(2);
  // the copy gets its own id
  expect(new Set(sectionRows(backend).map((r) => r['id'])).size).toBe(HOME.sections.length + 1);
});

test('blocks: add to a text section, reorder, move to another column and delete', async ({ page }) => {
  const backend = live();
  await mountAdmin(page, backend);
  await addSection(page, /^Columns/);
  await expect(canvas(page).locator('main > [data-section-type="columns"]')).toBeVisible();
  await settled(page);
  const panel = page.getByRole('complementary', { name: 'Settings' });
  const id = sectionRows(backend)[0]!['id'];
  const blocksOf = () => backend.tables['blocks']!.filter((b) => b['section_id'] === id).sort((x, y) => x['column_index'] - y['column_index'] || x['position'] - y['position']);

  await panel.getByRole('button', { name: 'Add a block to column 1' }).click();
  await page.getByRole('dialog', { name: 'Add a block' }).getByRole('button', { name: /^Divider/ }).click();
  await expect(canvas(page).locator('.block--divider')).toBeVisible();
  await settled(page);
  expect(blocksOf().map((b) => [b['type'], b['column_index']])).toEqual([['paragraph', 0], ['divider', 0], ['paragraph', 1]]);

  // the new (selected) block moves up by the panel, then to column 2
  await panel.getByRole('button', { name: 'Move Divider block up' }).click();
  await expect(canvas(page).locator(`[data-section-id="${id}"] .columns__col:first-child > :first-child`)).toHaveClass(/block--divider/);
  await settled(page);
  expect(blocksOf().map((b) => b['type'])).toEqual(['divider', 'paragraph', 'paragraph']);
  await panel.getByLabel('Column', { exact: true }).selectOption('1');
  await expect(canvas(page).locator(`[data-section-id="${id}"] .columns__col:nth-child(2) .block--divider`)).toBeVisible();
  await settled(page);
  expect(blocksOf().map((b) => [b['type'], b['column_index']])).toEqual([['paragraph', 0], ['paragraph', 1], ['divider', 1]]);

  // lowering the column count moves the blocks of the removed column into the last one
  await canvas(page).locator(`[data-section-id="${id}"]`).click({ position: { x: 4, y: 4 } });
  await panel.getByLabel('Columns', { exact: true }).selectOption('3');
  await expect(canvas(page).locator(`[data-section-id="${id}"] .columns__col`)).toHaveCount(3);
  await settled(page);
  await panel.getByRole('button', { name: 'Add a block to column 3' }).click();
  await page.getByRole('dialog', { name: 'Add a block' }).getByRole('button', { name: /^Spacer/ }).click();
  await expect(canvas(page).locator('.block--spacer')).toHaveCount(1);
  await settled(page);
  await canvas(page).locator(`[data-section-id="${id}"]`).click({ position: { x: 4, y: 4 } });
  await panel.getByLabel('Columns', { exact: true }).selectOption('2');
  await expect(canvas(page).locator(`[data-section-id="${id}"] .columns__col`)).toHaveCount(2);
  await settled(page);
  expect(Math.max(...blocksOf().map((b) => b['column_index']))).toBe(1);
  expect(blocksOf()).toHaveLength(4);

  // delete a block
  await panel.getByRole('button', { name: 'Spacer', exact: true }).click();
  await panel.getByRole('button', { name: 'Delete Spacer block' }).click();
  await expect(canvas(page).locator('.block--spacer')).toHaveCount(0);
  await settled(page);
  expect(blocksOf().map((b) => b['type'])).not.toContain('spacer');
});

test('gallery and featured sections choose their works and the order from the panel', async ({ page }) => {
  const backend = live();
  await mountAdmin(page, backend);
  await canvas(page).locator('[data-section-type="gallery"]').click({ position: { x: 4, y: 4 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  await panel.getByLabel('Works shown').selectOption('category');
  await panel.getByRole('checkbox', { name: 'Animation' }).check();
  await panel.getByLabel('Sort').selectOption('title');
  await settled(page);
  const gallery = sectionRows(backend).find((r) => r['type'] === 'gallery')!;
  expect(gallery['settings'].source).toEqual({ kind: 'category', categoryIds: ['animation'] });
  expect(gallery['settings'].sort).toBe('title');

  await canvas(page).locator('[data-section-type="featured"]').click({ position: { x: 4, y: 4 } });
  const second = snapshot.works[1]!;
  await panel.getByRole('checkbox', { name: second.title }).check();
  await settled(page);
  const featured = () => sectionRows(backend).find((r) => r['type'] === 'featured')!['settings'].workIds as string[];
  const ids = featured();
  expect(ids).toContain(second.id);
  await panel.getByRole('button', { name: `Move ${second.title} up` }).click();
  await settled(page);
  expect(featured().indexOf(second.id)).toBeLessThan(ids.indexOf(second.id));
});

test('hover shows the section toolbar, and every toolbar action is a labelled button', async ({ page }) => {
  await mountAdmin(page, live());
  const hero = canvas(page).locator('[data-section-type="hero"]');
  await hero.hover();
  const bar = canvas(page).getByRole('toolbar', { name: 'hero section' });
  await expect(bar).toBeVisible();
  for (const name of [/^Drag hero section/, 'Move hero section up', 'Move hero section down', 'Duplicate hero section', 'Settings of hero section', 'Delete hero section']) await expect(bar.getByRole('button', { name })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Move hero section up' })).toBeDisabled();
  expect(HERO.type).toBe('hero');
});

test('moving a section with the handle moves that section when a hidden one sits between two visible ones', async ({ page }) => {
  const backend = live();
  backend.tables['sections']!.find((r) => r['type'] === 'featured')!['show_on_desktop'] = false;
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  const gallery = canvas(page).locator('main > [data-section-type="gallery"]');
  await gallery.hover();
  const galleryId = (await gallery.getAttribute('data-section-id'))!;
  await canvas(page).locator(`.ed-tb--section[data-for="${galleryId}"] [data-ed="drag"]`).focus();
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => order(page)).toEqual(['hero', 'featured', 'cta', 'gallery', 'about', 'contact']);
  await settled(page);
  expect(types(backend)).toEqual(['hero', 'featured', 'cta', 'gallery', 'about', 'contact']);
});

test('the 25th featured work cannot be ticked, and the panel says why', async ({ page }) => {
  const backend = live();
  const build = backend.rpc['build_content_v3']!;
  const extra = Array.from({ length: 20 }, (_, i) => ({ ...snapshot.works[0]!, id: `extra-${i + 1}`, slug: `extra-${i + 1}`, title: `Extra work ${i + 1}` }));
  backend.rpc['build_content_v3'] = (...args: unknown[]) => {
    const out = (build as (...a: unknown[]) => any)(...args);
    return { ...out, works: [...out.works, ...extra] };
  };
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  await canvas(page).locator('[data-section-type="featured"]').click({ position: { x: 4, y: 4 } });
  const panel = page.getByRole('complementary', { name: 'Settings' });
  const boxes = panel.locator('.worklist input[type="checkbox"]');
  const count = await boxes.count();
  expect(count).toBeGreaterThan(24);
  const checked = panel.locator('.worklist input[type="checkbox"]:checked');
  while ((await checked.count()) < 24) await panel.locator('.worklist input[type="checkbox"]:not(:checked)').first().click();
  await expect(panel.locator('.worklist input[type="checkbox"]:checked')).toHaveCount(24);
  await expect(panel.locator('.worklist input[type="checkbox"]:not(:checked)').first()).toBeDisabled();
  await expect(panel.getByText(/maximum of 24 works/)).toBeVisible();
  await settled(page);
  expect((sectionRows(backend).find((r) => r['type'] === 'featured')!['settings'].workIds as string[]).length).toBe(24);
});

test('keyboard focus returns to the button that opened the section picker', async ({ page }) => {
  await mountAdmin(page, live());
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  const add = page.getByRole('button', { name: 'Add a section' });
  await add.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a section' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(add).toBeFocused();
});

test('"+" inserts at the right place and focus returns to the in-canvas button when a section is not drawn', async ({ page }) => {
  const backend = live();
  backend.tables['sections']!.find((r) => r['type'] === 'featured')!['show_on_desktop'] = false;
  await mountAdmin(page, backend);
  await expect(canvas(page).locator('.hero__title')).toBeVisible();
  const plus = canvas(page).getByRole('button', { name: /^Add a section before gallery section/ });
  await plus.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add a section' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(plus).toBeFocused();
});
