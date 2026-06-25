# Build flags & scripts

How the Vite build is parameterised (`vite.config.ts`). Two layers: **npm scripts** that set env flags, and
the **client constants** those flags resolve to (statically replaced at build time via `define`).

## Scripts

| Script               | What it does                                                                                    |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run dev`        | Vite dev server (all entries; debugger fully visible). Needs `npm run serve:static` for assets. |
| `npm run build`      | Full build — **all** HTML entries (main + the 3 dev viewers), debugger fully visible.           |
| `npm run build:prod` | **Deploy build** — drops the viewers and hides the dev-only debugger sections (see flags).      |
| `npm run preview`    | Serves the last `dist/` (use after a build to verify the result in a browser).                  |

## Env flags (build-time, set by the scripts)

| Env var                     | Set by       | Effect                                                                                                                                                  |
| --------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OPENSA_NO_VIEWERS=true`    | `build:prod` | Rollup `input` keeps only `index.html`; the `viewer.html` (tabbed object/vehicle/character) + `controls-harness.html` entries are excluded from `dist`. |
| `OPENSA_DEBUGGER_HIDE=true` | `build:prod` | Hides the authoring/tuning debugger sections (see `__DEBUGGER_HIDE__`).                                                                                 |

Both are plain `process.env` flags read in `vite.config.ts` (mac/linux inline syntax). They are **not**
`VITE_`-prefixed, so they never leak into `import.meta.env` / the client bundle.

## Runtime config (`.env`, `VITE_`-prefixed)

Client-visible config read from `.env` (copy `.env.example` → `.env`; `.env` is gitignored). Typed in
`apps/web/src/vite-env.d.ts`. Only two env vars remain — per-game settings (loader, character, vehicles, spawn,
teleports, …) live in the runtime catalogue **`apps/web/src/game-config.tsx`** (`GAME_CONFIG`), picked from the menu
(plan 056).

| Env var           | Default                 | Effect                                                                               |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `VITE_STATIC_URL` | `http://localhost:3001` | Where built game archives + viewer fixtures are served (see `npm run serve:static`). |
| `VITE_GA_ID`      | _(unset)_               | Google Analytics id; unset → analytics skipped.                                      |

**`scripts/build-game.ts`** reads the per-game `mainCharacter` + `vehicles` from `GAME_CONFIG` (by `--game`),
so the chosen character + cars are packed into the fetch archives too — they're spawned dynamically, not
placed on the map, so the partition would otherwise miss them. Rebuild after changing them.

## Client constants (`define` — statically replaced)

| Constant               | Type      | Value                                                                 | Use                                                       |
| ---------------------- | --------- | --------------------------------------------------------------------- | --------------------------------------------------------- |
| `__APP_VERSION__`      | `string`  | `package.json` `version`                                              | Use anywhere in code as the build version.                |
| `__DEBUGGER_HIDE__`    | `boolean` | `true` only under `build:prod` (`OPENSA_DEBUGGER_HIDE`), else `false` | Gates the dev-only debugger sections.                     |
| `process.env.NODE_ENV` | `string`  | `'production'` for any `vite build`, `'development'` for `vite dev`   | General prod/dev check. **Not** wired to debugger hiding. |

Types are declared in `apps/web/src/vite-env.d.ts` (`__APP_VERSION__`, `__DEBUGGER_HIDE__`); `process.env` is typed via
`@types/node`.

### Debugger sections gated by `__DEBUGGER_HIDE__`

`apps/web/src/ui/debug/debug-overlay.tsx` filters its `MENU` by `DEV_ONLY_SCREENS`: **Atmosphere, Camera, Graphics,
ProcObj, Map**. They show in `dev` and the plain `build`, and are hidden only in `build:prod`. The always-on
sections are Player, Vehicles, Time, Weather, Position.

### Dev-only games gated by `process.env.NODE_ENV`

A game in `GAME_CONFIG` (`apps/web/src/game-config.tsx`) flagged `devOnly: true` is dropped from the menu in **any**
production build (`vite build` / `build:prod`) and kept only under `npm run dev` (and the e2e dev server). The
filter is the pure `selectGameIds(config, isDev)` (`apps/web/src/game-config.select.ts`), with `isDev =
process.env.NODE_ENV !== 'production'`. Today **gostown** (a `fetch` demo that would distribute mod content
from the CDN) is `devOnly`, so a deployed site offers only **San Andreas** (local, bring-your-own-files) — see
[Legal & takedowns](../../README.md#legal--takedowns). The dev-only game's config strings still sit inert in
the bundle (the catalogue is indexed by id), but it is never listed, selectable, or fetched; just as
importantly, **its built chunks (`static/games/gostown-*`) must not be uploaded** to the prod CDN.

## Other build-time injection (`vite.config.ts` plugins)

- **`emit-og-image`** — copies `apps/web/src/assets/og.jpg` → `dist/assets/og.jpg` with a **stable** name (no content
  hash), so `og:image` / `twitter:image` in `index.html` can point at `https://opensa.cc/assets/og.jpg`.
- **`emit-favicons`** — copies the favicon set + `site.webmanifest` from `apps/web/src/assets/favicon/` to the build
  **root** with stable names, matching the `<link rel="icon"/manifest>` tags in `index.html` and the
  manifest's root-relative icon paths.
- **`inject-version-comment`** — stamps `<!-- OpenSA v<version> -->` at the top of `index.html`'s `<head>`
  (main entry only; viewer pages are skipped).

## Verify

```bash
npm run build      && npm run preview   # F2 → all debugger sections present; /viewer.html exists
npm run build:prod && npm run preview   # F2 → Atmosphere/Camera/Graphics/ProcObj/Map gone; viewers 404
```

Both builds emit `dist/assets/og.jpg`, the favicon set + `site.webmanifest` at the `dist/` root, and the
version comment in `dist/index.html`.
