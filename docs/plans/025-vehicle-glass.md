# 025 — Vehicle glass disappearing at angles (RenderWare alpha bug)

## Symptom

Car windows vanish from certain camera angles (very visible on the **admiral**). A classic
RenderWare vehicle-alpha bug; SilentPatch and SkyGFX both fix it.

## How our glass works today

`buildVehicleMaterial` (`src/renderware/three/build-vehicle.ts`) marks a material translucent when its
**colour alpha < 255**: `transparent = true`, `opacity = a/255`, `depthWrite = false`, `side =
DoubleSide`. Each vehicle atomic is **one `Mesh`** with a multi-material array + per-material geometry
groups (`buildGeometry` → `addGroup` per material). So a car's glass panes (windscreen + side/rear
windows) live as transparent groups **inside the same mesh**, sharing that mesh's single sort key.

## Root cause

- **Original RW/PC bug:** vehicle glass is drawn single-pass with **back-face culling** and only a
  coarse, atomic-level alpha sort. At angles where you'd see the _inside_ of the far glass it is culled,
  and overlapping panes mis-sort → windows blink out.
- **Our three.js port:** three sorts transparency **per render-item by the object's centre distance**,
  not per triangle. All of a mesh's glass groups share that one distance, so they draw in fixed
  geometry order. With `depthWrite = false` + single-pass `DoubleSide`, from the "wrong" side the order
  is back-to-front-reversed and a pane gets painted over / drops out — the same visual as the RW bug.

## What SilentPatch / SkyGFX do

Both force vehicle glass to render **two-sided in two passes** (the PS2/mobile path): draw the
**back faces first, then the front faces** (each depth-sorted correctly), so you see through the
windshield and both windows from any angle instead of one side culling out. SkyGFX restores the PS2
vehicle-alpha pipeline; SilentPatch forces the two-sided/twopass alpha + corrects the sort. Neither
relies on PC's single-pass culled draw.

## Options for us

- **A — Two-pass back/front glass (recommended).** Split each atomic's **glass** groups into their own
  geometry/mesh; render it twice — a `BackSide` material then a `FrontSide` material (both transparent,
  `depthWrite = false`), with `renderOrder` so back draws before front (and both after opaque). This is
  the three.js equivalent of the SilentPatch/SkyGFX fix and resolves the dominant "far side culls /
  vanishes" artifact. Residual: two _separate_ panes at the same object-z can still tint-order oddly
  (rare, not a disappearance).
- **B — Per-surface objects (max correctness, heavier).** Put each glass surface in its own Object3D so
  three sorts them individually by distance. Most correct, but more meshes/draws and more build code;
  overkill for now.
- **C — Alpha-test fallback (cheap, stable, less pretty).** Render glass as a cutout: `depthWrite =
true`, small `alphaTest`, not blended. Never disappears and needs no sorting, but the glass looks
  solid-tinted (no smooth blend) — like SA-mobile. Good as a quick toggle / safety net.

**Recommendation:** implement **A**. Keep **C** in reach as a config/material fallback if A still shows
artifacts on some model.

## Status

DONE — Option A shipped. `vehicleMesh` (`build-vehicle.ts`) now returns an `Object3D`: with no glass a
plain `Mesh` (unchanged); with glass it's a `Group` of an opaque mesh + two single-sided glass meshes
sharing one glass geometry (`BackSide` renderOrder 1, then `FrontSide` renderOrder 2; `depthWrite`
false). Glass = materials with colour alpha < 255 (`material.transparent`), triangles split via
`withTriangles`. All callers (panels/doors/`_vlo`/damage/vehicle-viewer) treat it as one node, so no
other changes. `build-vehicle.test.ts` updated (16 tests, incl. the two-pass split).

## Iterations

1. **Detect + isolate glass.** In `build-vehicle.ts`, partition an atomic's triangles into opaque vs
   **glass** (material colour alpha < 255, matching the current rule) and build two geometries: the
   opaque mesh as today + a separate glass geometry. (A small `splitGlassGeometry(rwGeometry,
materials)` helper, renderware-agnostic, unit-tested.)
2. **Two-pass glass mesh.** Build the glass as a tiny group of two meshes sharing the glass geometry —
   `BackSide` (lower `renderOrder`) then `FrontSide` (higher) — both transparent, `depthWrite = false`,
   `DoubleSide` removed (each pass is single-sided). Wrap opaque + glass-group in one Object3D so
   `vehicleMesh` still returns a single node (BuiltPart `ok`/`dam`, doors, `_vlo`, damage toggles, the
   vehicle viewer all keep working unchanged — they treat it as `Object3D`).
3. **Verify + tune.** Check the admiral (and camper/admiral2) from all angles in-game and in
   `/viewer.html?tab=vehicle`; confirm damage `_ok`/`_dam` swap, doors, and LOD still render correctly.
   Update `build-vehicle.test.ts` for the split (glass now a separate mesh). Optionally expose the
   Option-C alpha-test fallback behind a flag.

## Touch list

- `src/renderware/three/build-vehicle.ts` — glass split + two-pass build in `vehicleMesh` (and its
  helpers `addPanel`/`addDoor`/body/`_vlo` keep returning one `Object3D`).
- New `splitGlassGeometry` helper (+ test) — or inline in build-vehicle if small.
- `src/renderware/three/build-vehicle.test.ts` — assert glass is a separate two-pass mesh; existing
  part/door/wheel tests stay green.
- No game/adapter/physics changes (collision unaffected — this is render-only).

## Out of scope

A real water/glass shader, environment reflections on glass (SkyGFX "neo" specular), per-pixel depth
sorting, and fixing map-object transparency (fences/windows) — this plan is vehicle glass only.

```

```
