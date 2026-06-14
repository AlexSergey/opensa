# Build flags & scripts

How the Vite build is parameterised (`vite.config.ts`). Two layers: **npm scripts** that set env flags, and
the **client constants** those flags resolve to (statically replaced at build time via `define`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (all entries; debugger fully visible). Needs `npm run serve:static` for assets. |
| `npm run build` | Full build — **all** HTML entries (main + the 3 dev viewers), debugger fully visible. |
| `npm run build:prod` | **Deploy build** — drops the viewers and hides the dev-only debugger sections (see flags). |
| `npm run preview` | Serves the last `dist/` (use after a build to verify the result in a browser). |

## Env flags (build-time, set by the scripts)

| Env var | Set by | Effect |
|---|---|---|
| `OPENSA_NO_VIEWERS=true` | `build:prod` | Rollup `input` keeps only `index.html`; the `character/object/vehicle-viewer.html` entries are excluded from `dist`. |
| `OPENSA_DEBUGGER_HIDE=true` | `build:prod` | Hides the authoring/tuning debugger sections (see `__DEBUGGER_HIDE__`). |

Both are plain `process.env` flags read in `vite.config.ts` (mac/linux inline syntax). They are **not**
`VITE_`-prefixed, so they never leak into `import.meta.env` / the client bundle.

## Client constants (`define` — statically replaced)

| Constant | Type | Value | Use |
|---|---|---|---|
| `__APP_VERSION__` | `string` | `package.json` `version` | Use anywhere in code as the build version. |
| `__DEBUGGER_HIDE__` | `boolean` | `true` only under `build:prod` (`OPENSA_DEBUGGER_HIDE`), else `false` | Gates the dev-only debugger sections. |
| `process.env.NODE_ENV` | `string` | `'production'` for any `vite build`, `'development'` for `vite dev` | General prod/dev check. **Not** wired to debugger hiding. |

Types are declared in `src/vite-env.d.ts` (`__APP_VERSION__`, `__DEBUGGER_HIDE__`); `process.env` is typed via
`@types/node`.

### Debugger sections gated by `__DEBUGGER_HIDE__`

`src/ui/debug/debug-overlay.tsx` filters its `MENU` by `DEV_ONLY_SCREENS`: **Atmosphere, Camera, Graphics,
ProcObj, Map**. They show in `dev` and the plain `build`, and are hidden only in `build:prod`. The always-on
sections are Player, Vehicles, Time, Weather, Position.

## Other build-time injection (`vite.config.ts` plugins)

- **`emit-og-image`** — copies `src/assets/og.png` → `dist/assets/og.png` with a **stable** name (no content
  hash), so `og:image` / `twitter:image` in `index.html` can point at `https://opensa.cc/assets/og.png`.
- **`inject-version-comment`** — stamps `<!-- OpenSA v<version> -->` at the top of `index.html`'s `<head>`
  (main entry only; viewer pages are skipped).

## Verify

```bash
npm run build      && npm run preview   # F2 → all debugger sections present; /object-viewer.html exists
npm run build:prod && npm run preview   # F2 → Atmosphere/Camera/Graphics/ProcObj/Map gone; viewers 404
```
Both builds emit `dist/assets/og.png` and the version comment in `dist/index.html`.
