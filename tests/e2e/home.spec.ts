import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const HOME = '/CesartPortfolio/';
const site = JSON.parse(readFileSync('content/site.json', 'utf8'));
const works: { slug: string; categoryId: string }[] = JSON.parse(readFileSync('content/works.json', 'utf8'));
const categories: { id: string; slug: string }[] = site.categories;

// Each layout section id maps to the landmark the home page renders for it.
const SECTION_SELECTOR: Record<string, string> = {
  hero: '.hero',
  featured: '#featured',
  grid: '#work',
  about: '#about',
  contact: '#contact',
};

const visibleTiles = '[data-work-grid] [data-tile]:not([hidden])';

test('sections render in layout-config order', async ({ page }) => {
  await page.goto(HOME);
  const expected = site.layout.sections.filter((s: { visible: boolean }) => s.visible).map((s: { id: string }) => s.id);
  const positions = await page.evaluate((selectors) => {
    const children = [...document.querySelectorAll('main > *')];
    return Object.entries(selectors).map(([id, sel]) => {
      const el = document.querySelector(sel);
      return { id, index: el ? children.indexOf(el) : -1 };
    });
  }, SECTION_SELECTOR);
  const rendered = positions.filter((p) => p.index >= 0).sort((a, b) => a.index - b.index).map((p) => p.id);
  expect(rendered).toEqual(expected);
});

test('filter chips work by keyboard', async ({ page }) => {
  await page.goto(HOME);
  const chip = page.locator('[data-filter="illustration"]');
  await chip.focus();
  await page.keyboard.press('Enter');
  const illustration = categories.find((c) => c.slug === 'illustration')!;
  const expectedCount = works.filter((w) => w.categoryId === illustration.id).length;
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(visibleTiles)).toHaveCount(expectedCount);
  await expect(page).toHaveURL(/\?category=illustration/);
  await expect(page.locator('[data-filter-status]')).toHaveText(`${expectedCount} works shown`);

  await page.locator('[data-filter="all"]').focus();
  await page.keyboard.press('Space');
  await expect(page.locator(visibleTiles)).toHaveCount(works.length);
  await expect(page).not.toHaveURL(/category=/);
});

test('?category= on load pre-selects the filter', async ({ page }) => {
  await page.goto(`${HOME}?category=animation`);
  await expect(page.locator('[data-filter="animation"]')).toHaveAttribute('aria-pressed', 'true');
  const animation = categories.find((c) => c.slug === 'animation')!;
  await expect(page.locator(visibleTiles)).toHaveCount(works.filter((w) => w.categoryId === animation.id).length);
});

test.describe('lightbox', () => {
  test('opens and closes by keyboard, navigates with arrows, restores focus', async ({ page }) => {
    await page.goto(HOME);
    const dialog = page.locator('[data-lightbox]');
    const firstLink = page.locator(`${visibleTiles} .tile__link`).first();
    await firstLink.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/work/${works[0].slug}/$`));
    const firstTitle = await dialog.locator('.detail__title').innerText();

    await page.keyboard.press('ArrowRight');
    await expect(dialog.locator('.detail__title')).not.toHaveText(firstTitle);
    await page.keyboard.press('ArrowLeft');
    await expect(dialog.locator('.detail__title')).toHaveText(firstTitle);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`${HOME}$`));
    await expect(firstLink).toBeFocused();
  });

  test('traps focus inside the dialog', async ({ page }) => {
    await page.goto(HOME);
    await page.locator('[data-work-grid] .tile__link').first().focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-lightbox]')).toBeVisible();
    for (const key of ['Tab', 'Shift+Tab']) {
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press(key);
        const inside = await page.evaluate(() => !!document.activeElement?.closest('[data-lightbox]'));
        expect(inside, `focus escaped the dialog after ${i + 1} ${key} presses`).toBe(true);
      }
    }
  });

  test('close button closes it', async ({ page }) => {
    await page.goto(HOME);
    await page.locator('[data-work-grid] .tile__link').first().click();
    await expect(page.locator('[data-lightbox]')).toBeVisible();
    await page.locator('[data-lightbox-close]').click();
    await expect(page.locator('[data-lightbox]')).toBeHidden();
  });
});

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('motion duration tokens resolve to 0', async ({ page }) => {
    await page.goto(HOME);
    const durations = await page.evaluate(() =>
      ['--dur-fast', '--dur-base', '--dur-reveal'].map((token) => {
        const probe = document.createElement('div');
        probe.style.transitionDuration = `var(${token})`;
        document.body.append(probe);
        const d = getComputedStyle(probe).transitionDuration;
        probe.remove();
        return { token, d };
      }),
    );
    for (const { token, d } of durations) expect(parseFloat(d), `${token} should be 0`).toBe(0);
  });

  test('filtering starts no tile animations', async ({ page }) => {
    await page.goto(HOME);
    await page.locator('[data-filter="animation"]').click();
    const running = await page.evaluate(
      () => document.getAnimations().filter((a) => !(a instanceof CSSTransition) && a.playState === 'running').length,
    );
    expect(running).toBe(0);
  });

  test('hero reel does not autoplay', async ({ page }) => {
    await page.goto(HOME);
    const hero = page.locator('video[data-video="hero"]');
    test.skip((await hero.count()) === 0, 'hero section has no video');
    await page.waitForTimeout(500);
    expect(await hero.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });
});

test.describe('videos', () => {
  test('every video has a poster', async ({ page }) => {
    await page.goto(HOME);
    const posters = await page.locator('video').evaluateAll((vs) => vs.map((v) => v.getAttribute('poster')));
    expect(posters.length).toBeGreaterThan(0);
    for (const poster of posters) expect(poster).toBeTruthy();
  });

  test('grid videos stay paused when not hovered', async ({ page }) => {
    await page.goto(HOME);
    await page.locator('#work').scrollIntoViewIfNeeded();
    const states = await page.locator('[data-work-grid] video').evaluateAll((vs) => vs.map((v) => (v as HTMLVideoElement).paused));
    expect(states.length).toBeGreaterThan(0);
    expect(states.every(Boolean)).toBe(true);
  });

  test('hero video pauses when scrolled off-screen', async ({ page }) => {
    await page.goto(HOME);
    const hero = page.locator('video[data-video="hero"]');
    test.skip((await hero.count()) === 0, 'hero section has no video');
    await expect.poll(() => hero.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect.poll(() => hero.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  });
});
