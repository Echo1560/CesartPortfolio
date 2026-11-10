import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { THEME_PRESET_LIST } from '../../src/lib/theme-presets';
import { themeToCss } from '../../src/lib/theme-css';

const HOME = '/CesartPortfolio/';

async function blocking(page: Page): Promise<string[]> {
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}): ${v.help} [${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}]`);
}

/** Swaps the built theme for a preset's CSS, exactly what a publish would write into #theme-css. */
async function applyPreset(page: Page, css: string) {
  await page.goto(HOME);
  await page.locator('#theme-css').evaluate((el, value) => (el.textContent = value), css);
  // Axe must not sample a colour mid-transition (reveal fade, colour change from the new theme).
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
}

for (const preset of THEME_PRESET_LIST) {
  for (const scheme of ['light', 'dark'] as const) {
    if (scheme === 'dark' && preset.tokens.colors.dark === null) continue;
    test(`preset ${preset.id} (${scheme} mode): no serious or critical axe violations`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await applyPreset(page, themeToCss(preset.tokens));
      expect(await blocking(page)).toEqual([]);
    });
  }
}
