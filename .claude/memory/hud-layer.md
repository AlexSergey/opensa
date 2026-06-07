---
name: hud-layer
description: HUD layer (plan 027) — DOM overlay over the canvas; clock; HUD vs future UI layer
metadata:
  type: project
---

Plan 027 (`.claude/plans/027-hud-layer.md`), DONE. The HUD is **DOM/React over the `<canvas>`** (not in
the WebGL scene), so it's inherently immune to post-processing and trivial to hide.

- `src/ui/hud/overlay.tsx` `Overlay` — full-screen fixed layer, `pointer-events:none`, **z 10**. The HUD
  and the future **UI/menu layer (z 20)** are **sibling** layers here, not nested — menus render above
  the passive HUD. Debug overlay stays z 1000.
- `src/ui/hud/hud.tsx` `Hud` — clock top-right; seeds from `game.getTime()`, updates on the `'time'`
  event; styled from `Config.hud.clock` (`color` fill + `borderColor`/`borderWidth` via
  `-webkit-text-stroke`, `fontSize`) and `Config.fonts.hud.clock` (family). Hidden when `'map-viewer'`
  or `'fly-camera'` is on.
- `src/ui/hud/load-fonts.ts` `loadFonts(fonts)` — registers `.ttf` (FontFace, name→bundled URL from
  `src/assets/fonts/`) before the scene; awaited in canvas-host before `game.init()`.
- New `'fly-camera'` `GameEvent` from `Game.setFlyCamera` (so the HUD hides in screenshot mode).
- Config: `Config.fonts.hud.clock` + `Config.hud.clock` (+ canvas-host + 4 fixtures). canvas-host default
  font `SixCaps-Regular`, white/black 1px, size 52.
- Clock freezes on pause (plan 026: clock advances only while `gameState === 'play'`).

Next: the UI/menu layer (z 20) + more HUD widgets (health/money/radar). Related: [[game-time]], [[fog]].
