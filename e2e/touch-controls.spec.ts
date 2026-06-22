import { expect, type Page, test } from '@playwright/test';

/**
 * E2E for the on-screen touch controls (plan 055): drives the real overlay (`src/ui/controls/`) in a browser
 * and asserts the resulting `TouchInputSource` signals. Uses the asset-light `/controls-harness.html` (no game
 * boot), which exposes the live source on `window.__touchSource`. Joysticks/buttons are driven with the real
 * pointer (`page.mouse` → pointer events); pinch with synthetic two-finger `TouchEvent`s.
 */
interface TouchSource {
  consumeLook(): { x: number; y: number };
  consumeZoom(): number;
  isActive(action: string): boolean;
  move(): { x: number; y: number };
}

declare global {
  interface Window {
    __setCanEnter: (value: boolean) => void;
    __touchSource: TouchSource;
  }
}

/** Press the pointer at an element's centre, run `body`, then release — reads the held state mid-press. */
async function holdAt(
  page: Page,
  selector: string,
  dragTo?: (cx: number, cy: number, w: number, h: number) => [number, number],
): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (!box) {
    throw new Error(`no element: ${selector}`);
  }
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (dragTo) {
    const [x, y] = dragTo(cx, cy, box.width, box.height);
    await page.mouse.move(x, y);
  }
}

test.describe('touch controls', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/controls-harness.html');
    await expect(page.locator('.sa-touch__move')).toBeVisible();
  });

  test('the move joystick reports a forward vector and recentres on release', async ({ page }) => {
    await holdAt(page, '.sa-touch__move', (cx, cy, _w, h) => [cx, cy - h / 2]); // push up = forward
    const moved = await page.evaluate(() => window.__touchSource.move());
    expect(moved.y).toBeGreaterThan(0.5);
    expect(Math.abs(moved.x)).toBeLessThan(0.2);

    await page.mouse.up();
    const released = await page.evaluate(() => window.__touchSource.move());
    expect(released.x === 0 && released.y === 0).toBe(true); // recentred (±0)
  });

  test('full move deflection engages run', async ({ page }) => {
    await holdAt(page, '.sa-touch__move', (cx, cy, _w, h) => [cx, cy - h]); // beyond the rim → clamped to full
    expect(await page.evaluate(() => window.__touchSource.isActive('run'))).toBe(true);
    await page.mouse.up();
  });

  test('the look joystick reports a look delta while held, zero on release', async ({ page }) => {
    await holdAt(page, '.sa-touch__look', (cx, cy, w) => [cx + w / 2, cy]); // push right
    expect((await page.evaluate(() => window.__touchSource.consumeLook())).x).toBeGreaterThan(0);

    await page.mouse.up();
    expect(await page.evaluate(() => window.__touchSource.consumeLook())).toEqual({ x: 0, y: 0 });
  });

  test('the Jump button holds while pressed', async ({ page }) => {
    const jump = page.getByRole('button', { name: 'Jump' });
    const box = await jump.boundingBox();
    if (!box) {
      throw new Error('no Jump button');
    }
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__touchSource.isActive('jump'))).toBe(true);
    await page.mouse.up();
    expect(await page.evaluate(() => window.__touchSource.isActive('jump'))).toBe(false);
  });

  test('a two-finger spread pinches to zoom in', async ({ page }) => {
    const zoom = await page.evaluate(() => {
      const touch = (id: number, x: number): Touch =>
        new Touch({ clientX: x, clientY: 200, identifier: id, target: document.body });
      const fire = (left: number, right: number): void => {
        window.dispatchEvent(
          new TouchEvent('touchmove', { cancelable: true, touches: [touch(1, left), touch(2, right)] }),
        );
      };
      fire(100, 200); // seed (distance 100)
      fire(100, 300); // distance 200 → fingers spread apart

      return window.__touchSource.consumeZoom();
    });
    expect(zoom).toBeLessThan(0); // spreading zooms in → negative camera zoom (smaller follow distance)
  });

  test('the Enter button appears only when entering/exiting is possible', async ({ page }) => {
    const enter = page.getByRole('button', { name: 'Enter' });
    await expect(enter).toHaveCount(0); // nothing in range → hidden

    await page.evaluate(() => window.__setCanEnter(true));
    await expect(enter).toBeVisible(); // near a car / seated → shown

    await page.evaluate(() => window.__setCanEnter(false));
    await expect(enter).toHaveCount(0);
  });
});
