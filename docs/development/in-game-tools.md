# In-game tools (debugger + dev viewers)

Developer tooling that ships with the build but stays out of the normal play path.

## In-game debugger

Press **F2** in the game for the debug menu. Opening it alone changes nothing in the world — it's a
multi-level menu:

- **Player** — Respawn (unstick on the spot), To Ganton.
- **Vehicles** — spawn Admiral/Camper in front of you; Flip the car you're in (wheels ↔ roof).
- **Game** — Show / Copy current coords.
- **Map** — Activate **Map Viewer**: free-fly camera, click to pick objects, and render chosen map
  sections (HD/LOD) + collision. Leaving the screen, closing (×), or pressing F2 exits it cleanly.
- Plus live tuning of atmosphere/graphics/camera/weather/procobj/time (dev builds).

**Screenshot camera** — press **K+M** to toggle a free-fly camera: it detaches from the player/car and
flies with the **arrow keys** + **mouse** look. It only moves the camera (rendering and the rest of the
game are untouched). Opening the debugger (F2) leaves fly mode.

Diagnostics logging is off by default; set `showLogs` in the `canvas-host.tsx` config to
`'debug' | 'log' | 'warn' | 'error'` to stream gated, typed `log` events to the console.

## Development viewers

Standalone debug pages, isolated from the game/streaming layers — each reuses the **real** build path, so
what you see is what the game produces. Each is its own Vite HTML entry; run `npm run dev` +
`npm run serve:static` and open the URL.

- **`/object-viewer.html`** — map models. Toggles for prelit vertex colours, MODULATE2X, the lit/unlit
  material, and **collision** (pre-extracted COL, see below).
- **`/vehicle-viewer.html`** — a car's parts. Pick a body part (highlighted, clamped to the COL bounds),
  open/close its door (button or `E`), swap it to its damaged mesh, and toggle the collision wireframe and
  the low-detail `chassis_vlo` LOD.
- **`/character-viewer.html`** — a skinned ped. Play any `ped.ifp` animation (looped), and toggle the
  skeleton and the collision capsule.

Each viewer reads its fixtures from a subfolder of `static/viewer/`: `objects/` (dff/txd + pre-baked COL —
map objects keep their collision in `gta3.img`, not the DFF), `vehicles/`, and `character/`. Sync them from
`game-src/viewer/` (and re-bake the object COL) with:

```bash
npm run viewer:assets:original
```

See [docs/plans/022-debug-viewers.md](../plans/022-debug-viewers.md) for the full design, and
[scripts.md](./scripts.md) for the offline debug scripts under `scripts/debug/`.
