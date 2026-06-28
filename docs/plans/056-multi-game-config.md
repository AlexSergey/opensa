# 056 — Multi-game runtime config (replace `.env` with `GAME_CONFIG`)

**Status: ✅ DONE (2026-06-23).** Move from a single build-time game (selected via `.env`) to **several games
chosen at runtime** from the menu, driven by a data-only `GAME_CONFIG` map. Replaces `game-config.ts` (env
reads) with `game-config.tsx` (the disclaimer is JSX). Builds on the asset loaders ([049](./049-asset-loader.md)/
[053](./053-asset-local-loader.md)) and the UI shell ([051](./051-ui-shell.md)).

> **Implemented (2026-06-23).** `src/game-config.tsx` — `GAME_CONFIG` (`gostown` = fetch, `original` = local)
> with `label`/`disable`/`disabledNote`/`disclaimer`/`assetLoader`/`mainCharacter`/`vehicles`/`playerSpawn`/
> `loadGame`/`vehiclesSpawn`/`teleports`/`playerHalfExtents`; `GameId`/`GAME_IDS`/`HUMAN_HALF_EXTENTS`. Removed
> all four game `.env` vars (`VITE_GAME_TYPE`/`VITE_ASSET_LOADER`/`VITE_MAIN_CHARACTER`/`VITE_VEHICLES`),
> `resolveLoaderKind`, `src/a.tsx`, `src/ui/locations.ts`. `createAssetLoader` takes `assetLoader`;
> `boot-machine` carries the selected game (phases `menu → disclaimer|folder → loading → warmup → playing`);
> `use-asset-boot` builds the loader/VFS lazily per game, loads all groups in one screen, remembers the
> disclaimer per game (`boot-storage`). `menu` lists games; `disclaimer`/`folder-prompt` take the game's
> disclaimer; `canvas-host` takes `gameId` and reads spawn/loadGame/vehicles/teleports from `GAME_CONFIG`;
> `debug-overlay` takes `teleports`. **`scripts/build-game.ts` reads `mainCharacter`/`vehicles` from
> `GAME_CONFIG`** (not env). Tests: `boot-machine`/`boot-storage` rewritten; `e2e/shell.spec.ts` rewritten
> (menu → fetch disclaimer/loading, error, local folder). All decisions above hold; the `playerHalfExtents`
> field is defined but unused so far.

## Context / problem

Today one game is fixed at build time: `VITE_GAME_TYPE` / `VITE_ASSET_LOADER` / `VITE_MAIN_CHARACTER` /
`VITE_VEHICLES`. The fetch loader eagerly downloads `core` **before** the menu (with a first-visit logo
intro), and a single global disclaimer gates the first Play. Per-game data is scattered: spawn +
`SPAWN_COLLISION_RADIUS` in `ui/locations.ts`; `startMinutes` / `DEFAULT_WEATHER` / `VEHICLE_PLACEMENTS` /
`CAR_COLORS` in `canvas-host.tsx`; `TELEPORTS` (per `GameType`) in `debug-overlay.tsx`. This only works for one
game.

## Decisions (confirmed)

- **Runtime selection.** Drop `VITE_GAME_TYPE`; the menu lists every `GAME_CONFIG` entry (`label`, `disable`)
  and the game is picked by click. No game `.env` vars at all.
- **Disclaimer remembered per game** (localStorage keyed by game id) — shown once per game, then skipped.
- **Single `playerSpawn`** per game seeds both the capsule and the collision zone (`loadGame` centres on it) —
  consistent with plan-055-era unification; no separate `loadGame.location`.
- **One loading screen.** After the disclaimer OK (fetch) the loader pulls **all** groups
  (data→others→models→textures) behind one progress screen → play. The eager pre-menu `core` download and the
  first-visit logo intro are removed (the menu is now the first screen).

## `GAME_CONFIG` shape (`src/game-config.tsx`)

```ts
type GameId = keyof typeof GAME_CONFIG; // replaces the GameType union

interface GameConfig {
  // Menu
  label: string; // button text, e.g. "Run Gostown Paradise [web]"
  disable?: boolean; // greyed in the menu
  disclaimer: ReactNode; // popup body (fetch: + OK; local: inside the folder prompt)

  // Loading
  assetLoader: 'fetch' | 'local'; // was VITE_ASSET_LOADER (per game now)

  // World + player
  mainCharacter: string; // peds.ide ped name (was VITE_MAIN_CHARACTER)
  // (no `vehicles` field — every car is pulled from vehicles.ide at build + listed in the debugger; see 053)
  playerSpawn: Vec3; // single source: capsule + collision-zone centre
  loadGame: { radius: number; startMinutes: number; weather: string }; // collision radius / clock / weather
  // (no `vehiclesSpawn` field — parked cars come from the game's `parked.json` in the VFS; absent → none)
  teleports?: { coords: Vec3; label: string }[]; // debug Position tab

  // — discretionary additions (see below) —
  disabledNote?: string; // why a disabled game is off (replaces global MAINTENANCE_NOTE)
  playerHalfExtents?: Vec3; // default [0.3, 0.3, 0.9]
}
```

Exports: `GAME_CONFIG`, `GameId` (alias kept as `GameType` for a transition), `GameConfig`.

### Discretionary additions (flag for sign-off)

1. **`weather` as a name**, not an index — store `'EXTRASUNNY_SMOG_LA'`; resolve via `WEATHER_NAMES.indexOf`
   at use (canvas-host already does this inline). Readable config.
2. **Fold `CAR_COLORS` into `vehiclesSpawn`** — each placement already carries its `colour`; drop the separate
   map.
3. **`disabledNote?`** per game — replaces the global `PLAY_ENABLED` kill-switch + `MAINTENANCE_NOTE`
   (a game is simply `disable: true` with an optional reason).
4. **`playerHalfExtents?`** per game (default the human box `[0.3,0.3,0.9]`) — room for non-human players later.

Staying **global** (engine constants, not per-game): `CELL_SIZE`, `WORLD_READY_TIMEOUT_MS`, `PLAYER_PLACEMENT`
(SA biped orientation), the debug **`WEATHERS`** selectable list, `WEATHER_NAMES`.

## Boot flow (new)

```
menu (list games)
  └─ pick game G ─► accepted(G)?
        ├─ no  ─► fetch: disclaimer popup (G.disclaimer + OK) ─► remember(G) ─► loading
        │        local: folder prompt WITH G.disclaimer + "Choose folder" ─► remember(G) ─► load
        └─ yes ─► fetch: loading            local: folder prompt (no disclaimer) ─► load
loading (one progress screen, all groups) ─► warmup ─► playing ↔ paused
                         └─ fail ─► error ─► retry
```

- `boot-machine`: state gains `game: GameId | null`; phases collapse `core`/`textures` → a single **`loading`**
  (`LoadingPhase`), drop the intro machinery. New selection event carries the picked id; the hook routes to
  `disclaimer` / `folder` / `loading` from `assetLoader` + `accepted(G)`.
- `use-asset-boot`: the loader/VFS/manifest are created **lazily on selection** (not on mount), keyed by `G`.
  `manifestUrl = ${BASE}/games/${G}-${__APP_VERSION__}/manifest.json`; `createAssetLoader` gets `assetLoader`
  from the config. Remove the eager-core effect, the intro state (`introStarted`/`introDone`/`coreReady`,
  `INTRO_*`), and the `GAME_TYPE`/`MAIN_CHARACTER`/`VEHICLES` module imports.

## Module changes

- **`game-config.tsx`** (new, replaces `game-config.ts`): the `GAME_CONFIG` map + types; no env reads.
- **`src/a.tsx`** (the sketch) and **`src/ui/locations.ts`** (spawn/radius/teleports): removed — absorbed.
- **`loaders/index.ts`**: `createAssetLoader` takes `assetLoader` (arg); delete `resolveLoaderKind()` +
  `VITE_ASSET_LOADER`. (`AssetLoaderKind` type stays.)
- **`shell/menu.tsx`**: render a button per game (`label`, `disable` + `disabledNote`); `onPlay(id)`.
- **`shell/disclaimer.tsx`**: take `children` (the game's `disclaimer`) + `onAccept`.
- **`shell/folder-prompt.tsx`**: embed the game's disclaimer above "Choose folder".
- **`shell/app.tsx`**: wire game selection + the new popups.
- **`shell/boot-machine.ts`** + **`use-asset-boot.ts`**: per above.
- **`shell/boot-storage.ts`**: `isDisclaimerAccepted(id)` / `rememberDisclaimerAccepted(id)` (per-game key).
- **`canvas-host.tsx`**: take the selected `GameConfig` (prop); read `playerSpawn` / `loadGame` /
  `vehiclesSpawn` / `mainCharacter` / `vehicles` from it; drop the module constants.
- **`debug-overlay.tsx`**: teleports from `config.teleports` (drop the `GameType`-keyed `TELEPORTS`).
- **`.env*`, `vite-env.d.ts`**: drop `VITE_GAME_TYPE` / `VITE_ASSET_LOADER` / `VITE_MAIN_CHARACTER` /
  `VITE_VEHICLES` (keep `VITE_STATIC_URL`, `VITE_GA_ID`). `.env.e2e` adjusted so the e2e picks a game.

## Scope

- **In:** the config map + types; runtime game selection in the menu; per-game disclaimer (remembered) +
  fetch/local routing; one-screen loading; canvas-host/debug parametrised by the selected game; env cleanup.
- **Out (later):** per-game build versions (all share `__APP_VERSION__`); a settings/remap UI; deep-linking a
  game by URL; migrating the spawn config into a shared schema.

## Risks / testing

- **`boot-machine.test.ts`** rewritten for the new phases + per-game selection (pure, easy).
- **e2e**: `shell.spec.ts` updated to pick a game from the menu (still local-only assets); the fetch happy path
  still needs built archives.
- Biggest churn is `use-asset-boot` (lazy per-game loader + dropped intro) — keep `boot-machine` pure and
  unit-tested to de-risk. Loader/VFS/camera/input untouched.
- `e2e/object-viewer` + the touch-controls harness are independent — unaffected.
