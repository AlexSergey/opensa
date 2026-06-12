# 042 — Missing world objects: in-IMG text IPLs + procobj scatter

## Context

Two known classes of world content we silently don't load:

1. **Text IPLs that live INSIDE gta3.img** (vanilla loads them straight from the archive; we only
   load IPLs listed in gta.dat from `static/data/maps/**`). Discovered while wiring the zone IFPs
   (plan 041): the extracted archive contents (`static/img/gta3anim/`) include
   `barriers1.ipl`, `barriers2.ipl`, `carter.ipl`, `crack.ipl`, `truthsfarm.ipl` — road barriers,
   Carter's place, the crack den, Truth's farm placements. None of these placements exist in our
   world today.
2. **procobj scatter** (carried from plan 004 "out of scope"): `data/procobj.dat` + COL surface
   materials drive procedurally scattered ground clutter (grass tufts, sea rocks, beach debris).
   The generic `procobj.ide` defs are already in the catalog; the scatter itself was never built.

## Iterations (sketch — refine when picked up)

1. **In-IMG IPL audit.** Verify against vanilla behaviour which of the found `.ipl` files SA
   actually auto-loads from the archive (vs mission-script-loaded ones — `crack.ipl`/`carter.ipl`
   may be runtime-toggled by missions; barriers are likely always-on). Cheap script: parse each,
   count instances, inspect areas in-game for visible gaps (the `inspect-area.ts` toolkit).
2. **Loader support.** Teach `resolveMap` an extra source: text IPLs read from the archive (the
   adapter already holds it in memory) or — simpler, consistent with streams — extract them next to
   `static/ipl_binary/` with a manifest entry. Decide placement gating for the mission-state ones
   (load always vs skip — document the choice).
3. **procobj scatter.** Parse `procobj.dat` (surface name → object set, density, size/rotation
   ranges); hook into collision/COL surface materials per cell; deterministic per-cell scatter
   (seeded by cell coords) → instanced placements merged into the existing cell build. Density as a
   config knob (it's pure decoration with a perf cost).
4. **Verification.** Barriers visible where vanilla has them; Truth's farm populated; scatter
   density comparable to vanilla on country surfaces; `npm test` + area scans stay green.

## Out of scope

Mission scripting (enabling/disabling crack/carter by progress), interiors, `occlu` sections.
