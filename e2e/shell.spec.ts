import { expect, test } from '@playwright/test';

/**
 * UI shell boot flow (plan 051): logo → menu → Play → disclaimer → textures, plus the manifest-failure
 * error path. Stops before the heavy texture download + WebGL boot (covered by the object-viewer e2e and
 * a one-off full smoke) so the lane stays fast. Needs the built `original-<version>` archives served.
 */
test.describe('ui shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear()); // fresh visit: intro + disclaimer
  });

  test('boots: logo → menu → Play → disclaimer → textures', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('.sa-logo svg')).toBeVisible();

    // priority + models loaded → menu
    const play = page.getByRole('button', { name: 'Play Game' });
    await expect(play).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('link', { name: 'Code' })).toBeVisible();
    await play.click();

    // first-time disclaimer
    const ok = page.getByRole('button', { name: 'OK' });
    await expect(ok).toBeVisible();
    await ok.click();

    // accepted → textures phase (disclaimer gone, preloader back)
    await expect(ok).toBeHidden();
    await expect(page.locator('.sa-preloader')).toBeVisible();
  });

  test('shows the error panel with retry when the manifest fails', async ({ page }) => {
    await page.route('**/manifest.json', (route) => route.abort());
    await page.goto('/');

    await expect(page.getByText('Something went wrong')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });
});
