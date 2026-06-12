# Zones, HUD, debug tooling

`src/game/zones/`, `src/ui/hud/`, `src/ui/debug/`, plans 022/023/027/035.

## Implemented

**Zones**
- `map.zon` level boxes → city classification (LA/SF/VEGAS/COUNTRYSIDE/DESERT) driving the
  per-city weather sets; desert detection by named `info.zon` zones.
- `info.zon` named zones + GXT lookup (CRC-32 hash WITHOUT the final inversion — not Jenkins)
  → district display names.

**HUD** (DOM overlay, immune to post-processing)
- Clock and zone-name widgets with configurable font/outline (`Config.hud`), SA-style fonts
  loaded via `loadFonts`; zone name fades on change.

**Debugger (F2)** — multi-level menu; opening it never touches the simulation:
- Player (respawn, coords), Vehicles (spawn admiral/camper), Time (presets + speed),
  Atmosphere (night/world-light calibration sliders), Camera (follow rig), Graphics (bloom,
  SSAO, tonemapping, reflections, water, sun/god-rays, clouds, stars, fog), **ProcObj**
  (per-category clutter knobs), Weather selector, Position (live coords + teleports incl.
  Truth's Farm), Map (map-viewer mode with manual cell selection, collision overlay,
  click-to-describe picking).
- Picking: instanced map objects (`userData.region`), procobj clutter (`userData.procObj`),
  road-sign text meshes report their host model.
- Debug URL params: `?nocull=1`, `?shadowdebug=1`.

## Known gaps / candidates

- HUD: no minimap/radar, no money/health (out of scope so far).
- Zone names cover exterior districts only.

## Test coverage anchors

zone tests (`city`, `zone-name`, `city-zone` systems), GXT hash tests, debug overlay is mostly
manual (UI), picking covered via adapter `describe` tests.
