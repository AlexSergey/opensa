import { expect, test } from '@playwright/test';

/**
 * The tab shell (`viewer.html` + `apps/viewer/shell.ts`): `?tab=` lazy-loads one of the three viewers
 * into one app. Shell-level only — asserts the right viewer mounts its canvas and the nav reflects the
 * active tab, independent of each viewer's asset fetches (the canvas is appended before any fetch).
 */
test.describe('viewer tabs', () => {
  test('defaults to the object tab', async ({ page }) => {
    await page.goto('/viewer.html');

    await expect(page.locator('.viewer-tabs a.active')).toHaveText('Object');
    await expect(page.locator('canvas')).toBeVisible();
  });

  for (const [tab, label] of [
    ['object', 'Object'],
    ['vehicle', 'Vehicle'],
    ['character', 'Character'],
  ] as const) {
    test(`?tab=${tab} loads the ${tab} viewer and marks its tab active`, async ({ page }) => {
      await page.goto(`/viewer.html?tab=${tab}`);

      await expect(page.locator('.viewer-tabs a.active')).toHaveText(label);
      await expect(page.locator('canvas')).toBeVisible();
    });
  }
});
