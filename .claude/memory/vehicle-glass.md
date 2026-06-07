---
name: vehicle-glass
description: Vehicle glass two-pass fix (plan 025) — windows no longer vanish at angles
metadata:
  type: project
---

Plan 025 (`.claude/plans/025-vehicle-glass.md`), DONE. Fixes the RenderWare bug where car windows
(notably admiral) disappear at certain angles — the SilentPatch / SkyGFX two-sided two-pass alpha fix,
ported to three.js.

- Cause: vehicle glass = materials with colour alpha < 255 (`material.transparent`), previously one
  `DoubleSide` single-pass mesh. three sorts transparency per-object, not per-triangle, so overlapping
  glass on one mesh blends in fixed order and a pane drops out from the "wrong" side.
- Fix in `vehicleMesh` (`src/renderware/three/build-vehicle.ts`): it now returns an `Object3D`. No glass
  → plain `Mesh` (as before). Glass present → a `Group` of: an opaque mesh (non-glass triangles) + a
  glass geometry rendered in **two single-sided passes** — `BackSide` (renderOrder `GLASS_BACK_ORDER`=1)
  then `FrontSide` (=2), both `depthWrite:false`. Triangles split by `withTriangles(rw, keep)`; per-pass
  materials are clones with the side set. Glass material indices = `material.transparent`.
- Callers (addPanel/addDoor/body/`_vlo`, damage `ok`/`dam` toggles, vehicle-viewer) treat the result as
  one `Object3D` — `Group.visible`/`applyMatrix4`/`name` all work, so nothing else changed.
- Residual (acceptable): two *separate* panes at the same object-z can still tint-order oddly (rare, not
  a disappearance). Fallback option C (alpha-test) noted in the plan if ever needed. Render-only — no
  collision/physics impact. Related: [[standalone-viewers]].
