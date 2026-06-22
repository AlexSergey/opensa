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

- `npm run serve:static` — serves `static/` on :3001 (`VITE_STATIC_URL`): the `static/viewer/` fixtures
  (`npm run viewer:assets`) **and** the built `static/games/<game>-<version>/` archives — all gitignored.
- `npm run dev -- --mode e2e --port 5174 --strictPort` — the Vite app on **:5174** (`baseURL`). The dedicated
  port (not the usual 5173) means the lane never reuses a hand-started dev server in another mode (e.g. the
  `local` loader). `--mode e2e` loads the committed **`.env.e2e`**, which forces `VITE_ASSET_LOADER=fetch` (it
  takes precedence over your local, gitignored `.env`), so e2e is deterministic regardless of your dev config.

Chromium is already installed under the repo's Playwright cache. If missing: `npx playwright install chromium`.

## Assets

`e2e/object-viewer.spec.ts` targets **`object-viewer.html`**, whose models live in `static/viewer/` —
generated locally (gitignored) from a GTA copy via `npm run viewer:assets`. Run that once after a fresh clone
before the viewer e2e (CI doesn't have game-src, so the e2e lane runs locally).
`e2e/asset-fetch-loader.spec.ts` mocks all network (`page.route`) — no assets needed.
`e2e/touch-controls.spec.ts` drives the on-screen touch overlay (plan 055) on the asset-light
**`controls-harness.html`** (no game boot) — move/look joysticks + Jump via the pointer, pinch via synthetic
`TouchEvent`s — and asserts the `TouchInputSource` it exposes on `window.__touchSource`. No assets needed.
`e2e/asset-local-loader.spec.ts` runs the local loader's real pipeline (directory walk + lazy VER2 reader +
selection + VFS) over an **in-page fake** File System Access tree — no real install / picker needed (the
native folder dialog can't be driven by Playwright).
`e2e/shell.spec.ts` exercises the UI shell boot flow (fetch mode); its happy path needs the built
**`static/games/original-<version>/`** chunk archives (gitignored), so that spec only runs where those are
present (not on GitHub-hosted CI). It stops before the full texture download + WebGL boot to stay fast.

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
