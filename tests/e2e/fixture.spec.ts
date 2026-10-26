import { expect, test } from '@playwright/test';
import { ADDED_WORK, ANIMATED_WORKS } from './build-fixture.mjs';

// Runs against a build of edited content: layout reordered, `about` hidden,
// and one extra works.json entry + media file. No source code differs.
const HOME = '/CesartPortfolio/';

test('visible:false hides a section and the layout order is applied', async ({ page }) => {
  await page.goto(HOME);
  await expect(page.locator('#about')).toHaveCount(0);
  const order = await page.evaluate(() =>
    [...document.querySelectorAll('main > *')].map((el) => (el.matches('.hero') ? 'hero' : el.id)).filter((id) => id && id !== 'lightbox'),
  );
  expect(order).toEqual(['contact', 'hero', 'work', 'featured']);
});

test('a work added through content only gets a grid item', async ({ page }) => {
  await page.goto(HOME);
  const tile = page.locator(`[data-tile][data-slug="${ADDED_WORK.slug}"]`);
  await expect(tile).toHaveCount(1);
  await expect(tile.locator('.tile__link')).toHaveAttribute('href', `${HOME}work/${ADDED_WORK.slug}/`);
});

test('a work added through content only gets a detail page', async ({ page }) => {
  const response = await page.goto(`${HOME}work/${ADDED_WORK.slug}/`);
  expect(response?.status()).toBe(200);
  await expect(page.locator('h1')).toHaveText(ADDED_WORK.title);
  await expect(page.locator('main img').first()).toBeVisible();
});

// Animated media: inline <video> from WebM/MP4 variants, GIF <img> when none exist.
test.describe('animated media', () => {
  const { withVariants, gifOnly } = ANIMATED_WORKS;
  const detail = (slug: string) => `${HOME}work/${slug}/`;

  test('variants render an inline video that plays and no GIF image', async ({ page }) => {
    await page.goto(detail(withVariants.slug));
    const video = page.locator('.media--animated .media__video');
    await expect(video).toHaveCount(1);
    await expect(video).toHaveJSProperty('muted', true);
    await expect(video.locator('source')).toHaveCount(2);
    await expect(page.locator('.media--animated .media__anim')).toHaveCount(0);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);
  });

  test('reduced motion keeps the video paused on its poster and offers a play control', async ({ browser }) => {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(`http://localhost:4323${detail(withVariants.slug)}`);
    const video = page.locator('.media--animated .media__video');
    const toggle = page.locator('[data-anim-toggle]');
    await expect(video).toHaveAttribute('poster', /.+/);
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('Play animation');
    await page.waitForTimeout(500);
    expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveText('Pause animation');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => !v.paused)).toBe(true);

    await toggle.click();
    await expect(toggle).toHaveText('Play animation');
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await context.close();
  });

  test('without variants the GIF image is rendered and no video', async ({ page }) => {
    await page.goto(detail(gifOnly.slug));
    await expect(page.locator('.media--animated video')).toHaveCount(0);
    const gif = page.locator('.media--animated img.media__anim');
    await expect(gif).toHaveCount(1);
    await expect(gif).toHaveAttribute('data-src', /\.gif$|^data:image\/gif/);
  });
});
