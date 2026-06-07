# GTA San Andreas map renderer

A TypeScript / three.js renderer for GTA San Andreas assets (RenderWare DFF/TXD, COL
collision, IMG archives, IPL/IDE world streaming) with a Rapier-physics player and vehicles.

```bash
npm run dev           # Vite dev server (the game at /)
npm run serve:static  # serve the static/ asset tree (required by dev)
```

## In-game debugger

Press **F2** in the game for the debug menu. Opening it alone changes nothing in the world — it's a
multi-level menu:

- **Player** — Respawn (unstick on the spot), To Ganton.
- **Vehicles** — spawn Admiral/Camper in front of you; Flip the car you're in (wheels ↔ roof).
- **Game** — Show / Copy current coords.
- **Map** — Activate **Map Viewer**: free-fly camera, click to pick objects, and render chosen map
  sections (HD/LOD) + collision. Leaving the screen, closing (×), or pressing F2 exits it cleanly.

Diagnostics logging is off by default; set `showLogs` in the `canvas-host.tsx` config to
`'debug' | 'log' | 'warn' | 'error'` to stream gated, typed `log` events to the console.

## Development viewers

Standalone debug tools, isolated from the game/streaming layers — each reuses the **real**
build path, so what you see is what the game produces. Each is its own Vite HTML entry; run
`npm run dev` + `npm run serve:static` and open the URL.

- **`/object-viewer.html`** — map models. Toggles for prelit vertex colours, MODULATE2X, the
  lit/unlit material, and **collision** (pre-extracted COL, see below).
- **`/vehicle-viewer.html`** — a car's parts. Pick a body part (highlighted, clamped to the COL
  bounds), open/close its door (button or `E`), swap it to its damaged mesh, and toggle the
  collision wireframe and the low-detail `chassis_vlo` LOD.
- **`/character-viewer.html`** — a skinned ped. Play any `ped.ifp` animation (looped), and toggle
  the skeleton and the collision capsule.

Map objects keep their collision in `gta3.img` (not in the DFF), so the object viewer reads
pre-baked COL from `static/viewer/<model>.col.json`. Regenerate after editing its model list:

```bash
npm run viewer:collision
```

See `.claude/plans/022-debug-viewers.md` for details.
