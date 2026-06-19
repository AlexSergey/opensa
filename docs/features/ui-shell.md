# UI shell (boot, menu, loading, pause)

`src/ui/shell/` — the app entry (plan 051). A lightweight React shell that paints instantly (no
three.js), drives the two-stage asset load with a branded loading screen, shows a menu, then lazy-loads
and reveals the game. Theme: black bg, white text, orange-gradient accent (from `logo.svg`).

## Implemented

- **Boot state machine** (`boot-machine.ts`, pure): `core → menu → disclaimer → textures → warmup →
playing`, plus `paused` and `error`. Retry up to `MAX_RETRIES` (3), then a degraded menu (Play disabled,
  links still work). **Local loader** (bring-your-own-files): boots to `menu` (no auto `core`), then
  **Play → `folder`** (pick the install) → `textures` (loads everything) — `initialBootState(autoLoad)` +
  the `CHOOSE_FOLDER`/`FOLDER_READY` events.
- **Hook** (`use-asset-boot.ts`): one `Vfs` + `AssetLoader` (via `createAssetLoader`); manifest at
  `${VITE_STATIC_URL}/<game>-${__APP_VERSION__}/manifest.json`. Fetch loads **priority + models** for the
  menu then **textures** after Play; local `restore()`s the remembered folder on mount and only reads after
  the folder gesture (`chooseFolder → prepare()`). Each phase runs once per attempt (retry/StrictMode-safe);
  reports progress + rotating status; persists `intro`/`disclaimer` flags in localStorage.
- **Instant shell, lazy game:** the initial bundle is React + shell + asset-loader + vfs + fflate
  (~77 kB gz); `app.tsx` does `lazy(() => import('../canvas-host'))`, so three.js/Rapier (~982 kB gz) load
  only past the menu.
- **Intro animation** (`logo.tsx` inlines the SVG; `shell.css`): centered pulse while loading → up + shrink
  to 200px → staggered fade-in of the wordmark then subtitle. Skipped on repeat visits (`opensa.intro.v1`).
- **Components:** `menu` (Play/Continue, Code/Blog/Videos links, degraded note), `preloader` (bar + rotating
  status), `disclaimer` (non-commercial/cache/analytics/credits + OK), `error-panel` (Retry), `folder-prompt`
  (local loader: the bring-your-own-files notice + "Choose game folder").
- **Game integration** (`canvas-host.tsx`): `world-ready` — a system watches `Velocity.grounded[player]` and
  reveals the game only once the player has landed (12 s fallback); `paused` → `game.setGameState('pause')`
  (Esc pause menu with Continue). `Vfs.addChunk` is idempotent by chunk file (retry-safe).
- **Analytics** (`analytics.ts`): gtag, `VITE_GA_ID`-gated — a no-op when unset (dev). See `.env.example`.
- **Debugger** re-skinned to the same theme (`debug-styles.ts`).

## Known gaps / candidates

- Placeholder external URLs (Code/Blog/Videos) in `menu.tsx`; prod GA id.
- No settings/key-rebinding/save-slot/localization UI yet.
- Textures load is "all at once" — per-zone lazy streaming is a future chunking phase.

## Test coverage anchors

- Unit: `boot-machine.test.ts`, `boot-storage.test.ts`, `boot-status.test.ts`.
- e2e: `e2e/shell.spec.ts` (logo → menu → Play → disclaimer → textures; manifest-failure → error/retry).
  The presentational components + GL boot are covered here / in the object-viewer lane (no RTL infra in repo).
