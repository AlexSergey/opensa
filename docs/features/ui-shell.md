# UI shell (boot, menu, loading, pause)

`src/ui/shell/` — the app entry (plans 051 / 056). A lightweight React shell that paints instantly (no
three.js), shows a **menu of the games in `GAME_CONFIG`**, runs the picked game's disclaimer + load behind a
branded loading screen, then lazy-loads and reveals the game. Theme: black bg, white text, orange-gradient
accent (from `logo.svg`).

## Implemented

- **Boot state machine** (`boot-machine.ts`, pure): `menu → (disclaimer | folder) → loading → warmup →
playing`, plus `paused` and `error`. State carries the selected `game`; `SELECT` routes a **fetch** game to
  `disclaimer` (or straight to `loading` when its disclaimer was already accepted) and a **local** game to the
  `folder` prompt. Retry up to `MAX_RETRIES` (3), then back to the menu. Nothing downloads until a game is
  picked (no eager pre-menu load).
- **Hook** (`use-asset-boot.ts`): a fresh `Vfs` + `AssetLoader` **per selected game** (via `createAssetLoader`
  with the game's `assetLoader`); manifest at `${VITE_STATIC_URL}/<game>-${__APP_VERSION__}/manifest.json`.
  On the `loading` phase it `init()`s then loads **all groups** in one screen → verify → warmup. Local
  `restore()`s the remembered folder and only reads after the folder gesture (`chooseFolder → prepare()`).
  Runs once per attempt (retry/StrictMode-safe); reports progress + rotating status; remembers disclaimer
  acceptance **per game** in localStorage.
- **Instant shell, lazy game:** the initial bundle is React + shell + asset-loader + vfs + fflate
  (~77 kB gz); `app.tsx` does `lazy(() => import('../canvas-host'))`, so three.js/Rapier (~982 kB gz) load
  only past the menu.
- **Logo** (`logo.tsx` inlines the SVG; `shell.css`): a centered pulse while loading, the small subtitled mark
  on the menu.
- **Components:** `menu` (one button per `GAME_CONFIG` game by `label`, disabled with `disabledNote`; +
  Code/Blog/Videos links), `preloader` (bar + rotating status), `disclaimer` (the game's notice + OK, fetch
  path), `error-panel` (Retry), `folder-prompt` (local loader: the game's disclaimer + the bring-your-own-files
  notice + "Choose game folder").
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
- e2e: `e2e/shell.spec.ts` (menu lists games; fetch game → disclaimer → loading; manifest-failure →
  error/retry; local game → folder prompt). The presentational components + GL boot are covered here / in the
  object-viewer lane (no RTL infra in repo).
