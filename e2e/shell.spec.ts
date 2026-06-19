import { expect, test } from '@playwright/test';

import { PLAY_ENABLED } from '../src/ui/shell/boot-machine';

/**
 * UI shell boot flow (plan 051): logo → menu → Play → disclaimer → textures, plus the manifest-failure
 * error path. Stops before the heavy texture download + WebGL boot (covered by the object-viewer e2e and
 * a one-off full smoke) so the lane stays fast. Needs the built `original-<version>` archives served.
 *
 * While the playable demo is disabled ({@link PLAY_ENABLED} = false, distribution rework), the play/error
 * flows are skipped and the maintenance state is asserted instead.
 */
test.describe('ui shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear()); // fresh visit: intro + disclaimer
  });

  test('boots: logo → menu → Play → disclaimer → textures', async ({ page }) => {
    test.skip(!PLAY_ENABLED, 'playable demo disabled while reworking distribution');
    await page.goto('/');

    await expect(page.locator('.sa-logo svg')).toBeVisible();

    // priority + models loaded → menu
    const play = page.getByRole('button', { name: 'Play Game' });
    await expect(play).toBeVisible({ timeout: 90_000 });
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
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
    test.skip(!PLAY_ENABLED, 'playable demo disabled while reworking distribution');
    await page.route('**/manifest.json', (route) => route.abort());
    await page.goto('/');

    await expect(page.getByText('Something went wrong')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('maintenance: menu shows, Play disabled, nothing downloads', async ({ page }) => {
    test.skip(PLAY_ENABLED, 'only asserted while the playable demo is disabled');
    let manifestRequested = false;
    await page.route('**/manifest.json', (route) => {
      manifestRequested = true;

      return route.abort();
    });
    await page.goto('/');

    const play = page.getByRole('button', { name: 'Play Game' });
    await expect(play).toBeVisible();
    await expect(play).toBeDisabled();
    await expect(page.getByText(/temporarily offline/i)).toBeVisible();
    await expect(page.getByRole('link', { name: 'GitHub' })).toBeVisible();
    expect(manifestRequested).toBe(false); // no asset fetch while disabled
  });
});
