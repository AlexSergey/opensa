# E2E + visual regression (Playwright)

The browser lane from plan 046, Iteration 8. **Separate from `npm test`** (Vitest = headless node units): it
boots the real Vite app + the static asset server and drives Chromium. Slower and asset-dependent, so it runs
on its own — never inside `npm test`.

## Run

```bash
npm run e2e            # run the suite (auto-starts the dev + static servers)
npm run e2e:ui         # Playwright UI mode (watch / debug)
npm run e2e:update     # regenerate screenshot baselines
```

`playwright.config.ts` starts two `webServer`s for you (reused if already running locally):
- `npm run serve:static` — serves `static/` on :3001 (`VITE_STATIC_URL`).
- `npm run dev -- --port 5173 --strictPort` — the Vite app on :5173 (`baseURL`).

Chromium is already installed under the repo's Playwright cache. If missing: `npx playwright install chromium`.

## Assets

`static/` is gitignored (like the rest of the game data) — the e2e lane needs it present, the same way the app
and `npm run dev` do. The current spec targets **`object-viewer.html`**, whose models live in the small,
self-contained `static/viewer/` (no 700 MB WIMG archive). The main app and the character/vehicle viewers need
the full archives, so they are out of scope for the asset-light CI lane for now.

## What is covered (`e2e/object-viewer.spec.ts`)

- **Smoke**: the viewer boots, a `<canvas>` is visible with non-zero size, and there are **no console/page
  errors** while the default model's `dff`/`txd`/`col` fetch and build (real fetch → parse → build → render
  pipeline in the browser).
- **Interaction**: the model `<select>` is populated and switching models keeps rendering.
- **Visual regression**: a baseline screenshot of the rendered canvas. Headless Chromium renders WebGL via
  **SwiftShader** (software), so frames are deterministic across machines; `maxDiffPixelRatio` gives a small
  tolerance for AA differences.

## Snapshots

Baselines live in `e2e/<spec>.ts-snapshots/` and **are committed**. Playwright suffixes them per platform
(e.g. `object-viewer-default-chromium-darwin.png`); a Linux CI run produces `…-linux.png`, so generate and
commit the CI-platform baseline once (run `npm run e2e:update` in the CI image, or a matching container).
Artifacts (`test-results/`, `playwright-report/`) are gitignored.

## Next (not yet wired)

Per plan 046 It.8, the deterministic visual baselines to add when the full assets are wired into the lane: sky
at fixed times/weathers, a vehicle at night with headlights, a streamed cell, a breakable smash, floodbeams —
each with fixed time/weather/camera and RNG disabled.
