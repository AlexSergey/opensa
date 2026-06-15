# 051 — UI shell (boot, menu, loading, pause)

A lightweight React shell that loads **instantly** (no game/three.js), drives the two-stage asset load with
a branded loading experience, shows a menu, then lazy-loads and reveals the game. Black background, white
text, orange-gradient hover. **Status: ✅ DONE (2026-06-15).**

> **Implemented:** `src/ui/shell/` — pure + unit-tested `boot-machine.ts` / `boot-storage.ts` /
> `boot-status.ts`; hook `use-asset-boot.ts` (phased loader/VFS, retry/StrictMode-safe, `__APP_VERSION__`
> manifest); `logo.tsx` (inlined SVG) + `shell.css` (theme + intro animation); `menu`/`preloader`/
> `disclaimer`/`error-panel`; `app.tsx` (state-machine host, lazy `import('../canvas-host')`); `analytics.ts`
> (gtag, `VITE_GA_ID`-gated, no-op in dev) + `.env.example`. Game wiring in `canvas-host.tsx`: `world-ready`
> (grounded watcher) + `paused`→`setGameState`. Debugger re-skinned (`debug-styles.ts`). `main.tsx` → `<App/>`,
> `game-bootstrap.tsx` removed. Build confirms the split (shell ~77 kB gz, game lazy ~982 kB gz). Tests:
> shell units + `e2e/shell.spec.ts` (boot flow + manifest-failure path); verified full boot in a real browser.
> Remaining placeholders: Code/Blog/Videos URLs in `menu.tsx`, the prod GA id.

Builds on the asset loader (049) + VFS (050). Replaces the temporary `game-bootstrap.tsx`.

## Theme (from `src/assets/logo.svg`)
- Background **`#000`**, text **`#fff`**, subtitle gray **`#989998`**.
- Orange hover/accent **gradient**: `#FD8709 → #F55C07` (top→bottom; `#FD870A` is the same orange).
- Tailwind isn't wired and the app uses inline styles; to animate the logo's inner path classes we need a
  real stylesheet. **Decision:** one dependency-free global CSS (`src/ui/shell/shell.css`, imported in
  `main.tsx`) with CSS custom properties for the tokens + all shell animations. No new deps → stays fast.

## Load strategy (initial bundle = shell only)
- **Eager (initial chunk):** React, the shell components, `src/asset-loader`, `src/vfs`, `fflate`. Small →
  paints the layout + logo immediately.
- **Lazy (`import()` on demand):** the game surface (current `CanvasHost`) and everything it pulls
  (three.js, Rapier, plugins, renderware build helpers). Vite code-splits the dynamic import; it's only
  fetched once we're past the menu, so first paint never waits on three.js.

## Boot state machine (`src/ui/shell/app.tsx`)
1. **`shell`** — React mounts the layout instantly (logo centered, hidden subtitle, bottom preloader area).
2. **`core`** — loader downloads **priority** then **models** into the VFS. The intro animation plays
   (below). Bottom preloader shows combined priority+models progress (one bar, not per-chunk) with rotating
   status text ("Loading", "Loading assets…", "Almost there…").
3. **`menu`** — priority+models verified. Menu: **Play Game**, **Code**, **Blog**, **Videos**.
4. **`disclaimer`** — Play clicked (first time / until accepted): the popup (below). OK → continue.
5. **`textures`** — loader downloads **textures**. Logo re-centers (no subtitle); a richer preloader with
   many rotating status lines.
6. **`warmup`** — assets complete; lazy-load the game module, `game.init()` + `loadGame()`; wait for the new
   **`world-ready`** event (world streamed in + player grounded) before revealing — no empty-world flash.
7. **`playing`** — game visible (canvas fades in).
8. **`paused`** — `Esc` pauses the game and shows the menu overlay with **Continue** (resume) + the same
   items.
9. **`error`** — see Error handling.

## Intro animation (stage `core`)
Driven by CSS classes toggled as phases complete (the logo is inlined so CSS can target its inner classes):
- During load: logo centered, **max-width 360px**, gentle **pulse** (opacity/scale keyframe). Subtitle
  (`.logo-opensa-title`, `.logo-opensa-description`) hidden by default.
- **priority done** → animate the logo **up + scale down to 200px** (transform on the wrapper, eased).
- On transition end → fade in **`.logo-opensa-title`**, then **`.logo-opensa-description`** (staggered
  opacity transitions).
- **Skip on repeat visits:** once priority+models complete the first time, set `localStorage`
  `opensa.intro.v1 = "1"`. When present, mount straight into the small-logo + subtitle state and skip the
  pulse/move (nothing to wait for — chunks are Cache-Storage cached, `load()` resolves fast).

## Disclaimer popup (`disclaimer.tsx`)
Shown on first Play (persist `opensa.disclaimer.v1` once OK'd). Content (concise, friendly):
- Technical/educational demo; non-commercial, no financial gain; not affiliated with Rockstar/Take-Two.
- We cache game data in the browser (Cache Storage) for faster reloads; Google Analytics is used only to
  count visitors (no personal data).
- Thanks: **mad_driver** for several vehicle models.
- **OK** button → persist + start the textures load.

## Preloader (`preloader.tsx`)
- A bottom progress bar; combined progress for the active phase (priority+models in `core`; textures in
  `textures`) from `ProgressTracker` snapshots (global, not per-chunk).
- Rotating status text on an interval so it never looks stuck. Richer copy set in the textures phase.

## Menu (`menu.tsx`)
- Items: **Play Game** (→ disclaimer/textures; label **Continue** when `paused`), **Code** (GitHub),
  **Blog**, **Videos** (external links — URLs as placeholders/config).
- Orange-gradient hover (CSS `background-image` gradient on hover, white→gradient text or underline).
- In the degraded error state, Play is disabled with a note; the other links stay active.

## Error handling + retry
- Any phase failure → **error panel**: message + **Retry**. Retry re-runs the failed phase (`loader.load`
  is idempotent — cached chunks skip).
- After **3 failed retries**: fall back to the **menu without Play** — "Sorry, the game is unavailable —
  something went wrong, please try later", but Code/Blog/Videos remain usable.

## Game integration changes
- **`world-ready` event:** the game emits it once the world has streamed around the spawn and the player is
  grounded/settled (e.g. player has a ground contact for a few frames after `loadGame`). The shell gates
  the `playing` reveal on it. (Add to `game.ts` / the character/physics settle path.)
- **Pause/resume:** `Esc` → `game.pause()` (stop the frame loop / input) + show the menu overlay;
  **Continue** → `game.resume()`. (Today `Esc` is unused at the shell level; F2 stays the in-game debugger.)
- The lazy game surface takes the `fs` (VFS) + `onWorldReady` + pause control; it no longer owns load
  overlays (the shell does).

## Analytics (`analytics.ts`)
- Minimal: inject the GA `gtag` script lazily from the shell and send one `page_view`/visit. Measurement ID
  via env (`VITE_GA_ID`); a no-op when unset. Mentioned in the disclaimer.

## Debugger restyle
- Re-skin `src/ui/debug/debug-styles.ts` (+ `debug-overlay`) to the new theme: black panels, white text,
  orange-gradient hover/active on buttons; shared CSS tokens with the shell. Behaviour unchanged.

## File layout (`src/ui/shell/`)
- `app.tsx` — the state machine + lazy game import.
- `use-asset-boot.ts` — hook: orchestrates loader/VFS phases, progress, retry, persistence (pure-ish logic
  → unit-testable; the state-machine reducer split out as `boot-machine.ts`).
- `boot-machine.ts` — **pure** reducer (states/transitions) → unit-tested.
- `logo.tsx` — inlines `logo.svg` (`?raw` + `dangerouslySetInnerHTML`) so CSS animates its classes.
- `menu.tsx`, `preloader.tsx`, `disclaimer.tsx`, `error-panel.tsx`.
- `shell.css` — tokens + animations + the `.logo-opensa-*` rules.
- `analytics.ts`.
- `main.tsx` renders `<App/>`; the temporary `game-bootstrap.tsx` is removed.

## Testing
- **Unit (vitest):** `boot-machine.ts` (phase transitions incl. retry→degraded after 3, persistence-skip),
  the status-text rotator, progress→percent mapping, persistence helpers (localStorage stubbed).
- **Component (RTL):** menu (items, Play disabled in degraded state, Continue label when paused), disclaimer
  (OK persists + proceeds), error panel (retry count). DOM-only, no game.
- **e2e (Playwright):** the shell boot path against the real build (logo → preloader → menu → disclaimer →
  textures → game canvas), reusing the loader's network. The heavy game stays in the existing app e2e.
- Per `gl-dom-coverage-exclusion`: the lazy game surface + GL wiring stay in `coverage.exclude` (e2e).

## Steps
1. `shell.css` + theme tokens; `logo.tsx` (inline SVG) + the intro animation; mount in `app.tsx` with a
   stubbed boot.
2. `boot-machine.ts` (+ tests) + `use-asset-boot.ts` wiring the loader/VFS phases (priority+models, then
   textures) with progress + retry + persistence.
3. `menu.tsx`, `preloader.tsx`, `disclaimer.tsx`, `error-panel.tsx` (+ component tests).
4. Lazy-load the game surface; thread `fs`; add the `world-ready` event + pause/resume; Esc → pause menu.
5. `analytics.ts` (gtag, env-gated).
6. Debugger restyle.
7. Remove `game-bootstrap.tsx`; point `main.tsx` at `<App/>`.
8. e2e for the shell path; docs (`docs/features/` UI note + `getting-started.md`).

## Open placeholders (need values, non-blocking)
- Code/Blog/Videos URLs; GA measurement ID (`VITE_GA_ID`); final disclaimer wording; exact thanks list.

## Out of scope / future
- Settings screen, key rebinding UI, save slots, localization — later.
- Per-zone lazy texture streaming (chunking phase 2) — the textures phase stays "load all" for now.
