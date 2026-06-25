import { expect, test } from '@playwright/test';

/**
 * Smoke + visual regression for the object-viewer — the asset-light real-pipeline page
 * (fetch → parseTxd/parseDff → build-texture/build-clump → instanced render). Boots from the
 * committed `static/viewer/` models, so it runs in CI without the full game archive.
 */
test.describe('object viewer', () => {
  test('boots and renders the default model without console/page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') {
        errors.push(message.text());
      }
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/viewer.html');

    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
    await page.waitForLoadState('networkidle'); // the default model's dff/txd/col fetches settle

    const box = await canvas.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeGreaterThan(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('switches between the available models', async ({ page }) => {
    await page.goto('/viewer.html');
    const select = page.locator('select').first();
    await expect(select).toBeVisible();

    const options = await select.locator('option').count();
    expect(options).toBeGreaterThan(1);

    await select.selectOption({ index: 1 });
    await page.waitForLoadState('networkidle');
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('matches the rendered baseline (WebGL via SwiftShader)', async ({ page }) => {
    await page.goto('/viewer.html');
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500); // let a few frames render the loaded clump

    await expect(page.locator('canvas')).toHaveScreenshot('object-viewer-default.png', { maxDiffPixelRatio: 0.05 });
  });
});
