# 027 — HUD layer (clock first)

## Goal

A HUD drawn **on top of everything**, immune to the post-processing we'll add later, easy to hide. It
shows the in-game **clock** (top-right) for now. Hidden when entering the **map viewer** and the
**screenshot (fly) camera**. The clock stops when the game is paused (see plan 026 update).

## Architecture — DOM overlay (and how HUD vs the future UI layer fit)

Render the HUD as **HTML/React over the `<canvas>`**, not inside the WebGL scene. DOM is always
composited above the canvas by the browser, so it is **inherently unaffected by any GL post-processing**
(bloom, fog, color grading, EffectComposer) — exactly the requirement — and trivial to hide
(unmount / `display:none`). This matches how the app already layers React DOM (preloader, debug overlay)
over the canvas. (A WebGL ortho overlay pass would have to be carefully excluded from every effect and
re-implement text/fonts — DOM is simpler and more robust here.)

**HUD vs UI layer (the important detail).** Keep them as **sibling layers in one overlay root**, stacked
by z-index, NOT HUD-inside-UI:

```
#root
  <canvas>                      ← the game (WebGL, post-processed)
  <Overlay>                     ← pointer-events: none; full-screen, above canvas
    <Hud/>      (z 10)          ← always-on gameplay readouts (clock, later health/money/radar)
    <UiLayer/>  (z 20, later)   ← menus / modals; pointer-events: auto; may dim + block input
    <DebugOverlay/> (z 1000)    ← dev only (existing)
```

Rationale: HUD and menus have different lifetimes and input behaviour — the HUD is passive
(`pointer-events: none`, never steals clicks) and persistent; menus are interactive and transient and
must be able to render **over** the HUD (and optionally hide it). Siblings let either be shown/hidden
independently and let menus overlay the HUD without the HUD owning menu concerns. So: not "HUD is part
of UI"; both are children of a shared `Overlay`, with the UI layer above. `src/ui/hud/` now,
`src/ui/menu/` (UI layer) later.

**Hiding.** `Hud` is visible unless map-viewer or the fly camera is active:
`visible = !(mapViewer || flyCamera)`. It listens to `'map-viewer'` (exists) and a **new
`'fly-camera'` event** emitted from `Game.setFlyCamera`. (The standalone object/vehicle/character
viewers are separate HTML pages with no HUD, so nothing to hide there.)

## Config (proposed — refine in review)

```ts
fonts: { hud: { clock: 'SixCaps-Regular' } }   // CSS font-family the clock uses
hud: {
  clock: { borderColor: '#000', borderWidth: 1, color: '#fff' }  // white fill, 1px black outline
}
```

Per-widget styling under `hud` (e.g. `hud.clock`) rather than one shared `hud.colors`, so future widgets
(health, money) each get their own colours/size without coupling. Fill = `color`, outline =
`-webkit-text-stroke: borderWidth px borderColor` (crisp 1px edge; text-shadow is the fallback). All in
config as requested.

## Asset / font loading (before the scene)

Fonts must be ready before the HUD draws. A small **font loader** module (`src/ui/hud/load-fonts.ts`):
imports the `.ttf` as a URL (Vite asset import of `src/assets/fonts/SixCaps-Regular.ttf`), builds a
`FontFace('SixCaps-Regular', url(...))`, `await face.load()`, `document.fonts.add(face)`. It keeps a
small `name → url` map so config can pick the family by name. `canvas-host` awaits `loadFonts()` **before**
`game.init()` / `loadGame` in the bootstrap, so the glyphs are available the moment the HUD mounts.
(Generic enough to grow into a `loadAssets()` for other preloaded assets later.)

## Status

DONE (iterations 1–2). DOM HUD over the canvas: `src/ui/hud/{overlay,hud,load-fonts}.tsx`. `Overlay`
(fixed, `pointer-events:none`, z 10; UI/menu layer reserved at z 20). `Hud` shows the clock top-right
(`'time'` event + `game.getTime()`), styled from `Config.hud.clock` + `Config.fonts.hud.clock`
(white fill + 1px black `-webkit-text-stroke`). Hidden on `'map-viewer'` / `'fly-camera'` (new event
from `setFlyCamera`). Fonts via `loadFonts()` (FontFace from `src/assets/fonts`), awaited before
`game.init()`. Clock freezes on pause (plan 026 amendment). `Config.fonts` + `Config.hud` (+ 4 fixtures).

## Iterations

1. **Overlay + fonts + config.** Add `Config.fonts.hud.clock` + `Config.hud.clock{color,borderColor,
   borderWidth}` (+ canvas-host + the 4 config test fixtures). `load-fonts.ts` (FontFace from
   `src/assets/fonts`); await it in bootstrap before `game.init()`. Add an `Overlay` container + empty
   `Hud` mounted in canvas-host (z-layered, `pointer-events:none`). No content yet — just the layer + font.
2. **Clock widget + hide + pause.** `Hud` renders the clock top-right (`GameClock.format`), seeded from
   `game.getTime()` and updated on the `'time'` event, styled from `Config.hud.clock` +
   `Config.fonts.hud.clock`. Add the `'fly-camera'` event to `Game.setFlyCamera`; hide the HUD on
   `map-viewer`/`fly-camera`. Clock-stops-on-pause comes from the plan-026 update (clock only advances
   while `gameState === 'play'`), so the HUD just shows the frozen value.

## Touch list

- `src/game/interfaces/config.interface.ts` — `FontsConfig` + `HudConfig` (+ `Config.fonts`, `Config.hud`).
- `src/ui/hud/load-fonts.ts` — FontFace loader (name → bundled URL).
- `src/ui/hud/hud.tsx` — the HUD layer + clock widget.
- `src/ui/hud/overlay.tsx` (or inline in canvas-host) — the stacking `Overlay` container.
- `src/game/game.ts` + `events.global.ts` — `'fly-camera'` event from `setFlyCamera`.
- `src/ui/canvas-host.tsx` — await `loadFonts()`; mount `<Overlay><Hud …/></Overlay>`.
- The 4 config test fixtures — add `fonts` + `hud`.

## Out of scope (later)

The **UI layer** itself (menus/pause screen/inventory) — only the seam is reserved here; more HUD
widgets (health, armour, money, weapon, radar/minimap, wanted stars, on-screen messages); HUD scaling
for resolution/DPI; controller/touch.
