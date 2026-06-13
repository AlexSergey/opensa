# 039 — SA IDE object flags: implement the render-relevant set

**STATUS: DONE (2026-06-10).** Every RENDER-relevant flag is implemented; the rest are gameplay
(intentionally skipped) or negligible. Final state, with empirical usage from
`scripts/ide-flag-histogram.ts` (14323 defs):

| Bit | Hex | Usage | Verdict |
|---|---|---|---|
| 2 | 0x4 DRAW_LAST | 2419 | ✅ implemented (`transparent = true` → sorted alpha list) |
| 3 | 0x8 ADDITIVE | 83 (`LTS*`, `nitelites*`) | ✅ implemented (AdditiveBlending + no depth write; replaces windowGlow for flagged overlays) |
| 6 | 0x40 NO_ZBUFFER_WRITE | 228 (`grnd_alpha*` decals) | ✅ implemented (`depthWrite = false`) |
| 13/14 | 0x2000/0x4000 trees/palms | 113 | ✅ implemented — moved into the **wind mod** (plan 040) |
| 21 | 0x200000 no backface cull | 1586 | ✅ implemented (plan 004) |
| 7 | 0x80 no shadow cast | 5134 | moot — the unlit map never casts (plan 038) |
| 0 | 0x1 IS_ROAD | 1937 | no render effect |
| 9/10/11/12/15/16/17/20/22 | glass/garage/dam/flyer/explosive/props/tags/statue | — | gameplay, skipped by design |
| 1/4/5/18 | 0x2/0x10/0x20/0x40000 | 33/2/31/1 | negligible usage, semantics fuzzy — revisit only if a concrete bug points at them |

Flags live in `parsers/text/ide-flags.ts` (`IdeFlag`/`hasIdeFlag`), applied in `build-region.ts`
(`defTreatment`/`applyTreatment`). Wind sway moved out to `src/game/mods/wind.mod.ts` via the
`decoratePart` hook — see plan 040 for the mod architecture, the wind shader and the model list.

## Context

Plan 004's since-add implemented exactly one IDE object flag — `0x200000` disable-backface-culling
(the trafficlight1 case) — as an ad-hoc constant inside `build-region.ts`. SA's engine reads a whole
bitfield per object def (`IdeObjectDef.flags`, already parsed); everything else is currently
ignored. This plan turns the flag handling into a first-class, named, tested subsystem and
implements the bits that affect **rendering**. Gameplay bits are documented and explicitly skipped.

## Documented SA flag map (verify-first: semantics confirmed empirically before relying on them)

| Bit | Hex | SA meaning | Action |
|---|---|---|---|
| 0 | 0x1 | IS_ROAD marker | ignore (no render effect) |
| 2 | 0x4 | DRAW_LAST — render in the sorted alpha list | **implement** |
| 3 | 0x8 | ADDITIVE blending (implies DRAW_LAST) — lamp glow cards, neon | **implement** |
| 6 | 0x40 | NO_ZBUFFER_WRITE (depthWrite off) | **implement** |
| 7 | 0x80 | don't cast shadows | moot — the unlit map never casts (plan 038) |
| 9/10 | 0x200/0x400 | breakable glass 1/2 | skip (gameplay) |
| 11 | 0x800 | garage door | skip (gameplay) |
| 12 | 0x1000 | damageable (`*_dam` model swap) | skip (gameplay) |
| 13 | 0x2000 | IS_TREE — wind sway | **implement** (visual) |
| 14 | 0x4000 | IS_PALM — wind sway | **implement** (visual) |
| 15 | 0x8000 | no flyer collision | ignore |
| 17 | 0x20000 | graffiti tag | skip (gameplay) |
| 21 | 0x200000 | disable backface culling | ✅ done (plan 004) — migrate to the new module |
| 22 | 0x400000 | breakable statue | skip (gameplay) |

Mid bits with fuzzy documentation are **not** implemented on faith: iteration 0's histogram gives
real usage + example models, and each implemented bit is verified on a real model first (the
trafficlight1 method).

## Iterations (each keeps `npm test` + the app green)

0. **Audit (data first).** Run `scripts/ide-flag-histogram.ts` (already written) → bit histogram +
   example models across every IDE `gta.dat` loads. Pick 1–2 real example models per candidate bit;
   confirm the expected visual semantics on them (in-game + asset forensics). Re-prioritise the
   table from the data. The script stays in `scripts/` as a reusable audit tool.

1. **Named flags module.** `src/renderware/parsers/text/ide-flags.ts`: an `IdeFlag` const map
   (`DRAW_LAST: 0x4, ADDITIVE: 0x8, NO_ZBUFFER_WRITE: 0x40, IS_TREE: 0x2000, IS_PALM: 0x4000,
   DISABLE_BACKFACE_CULLING: 0x200000`, + documented-but-skipped bits for reference) and a
   `hasIdeFlag(def, flag)` helper. Migrate `IDE_FLAG_DISABLE_BACKFACE_CULLING` out of
   `build-region.ts`; barrel export; unit tests (incl. the real trafficlight flags value 2130048).

2. **Alpha flags → world material.** In `buildInstancedMeshes` (flags travel per def, materials per
   part):
   - `DRAW_LAST`: force `transparent = true` (sorted), keep a low `alphaTest` (~0.1) so fully
     transparent texels don't occlude; `castShadow` already false (moot).
   - `ADDITIVE`: `blending = AdditiveBlending`, `depthWrite = false`, `transparent = true`.
   Real-asset regression test per bit using an example model from the audit (fixture in
   `tests/dff/<case>/`, like the trafficlight one).

3. **`NO_ZBUFFER_WRITE`**: `depthWrite = false` on the part materials. Same test pattern.
   (If the audit shows the bit unused in our data — document and skip the implementation.)

4. **Wind sway (`IS_TREE`/`IS_PALM`).** Vertex injection in `world-material.ts` (the established
   onBeforeCompile pattern): sway offset ∝ vertex height above the model base × `sin(uWindTime +
   phase(instance world position))`, a small amplitude for trees, larger/slower for palms. New
   shared `windUniform` driven from the existing per-frame driver in canvas-host; program-cache-key
   variants (`saWorld|tree` etc.). Calibration constants local first; config knob only if needed.

5. **Docs + closeout.** Plan status note; `hardcoded-fixes` untouched (these are general,
   data-driven); update plan 004's since-note to point here; memory note if any non-obvious
   semantics were discovered empirically.

## Risks / notes

- **Semantics uncertainty** on mid bits → the verify-first rule above; nothing lands without a
  real-model confirmation.
- **DRAW_LAST vs the cutout pipeline:** alpha-tested foliage (fences/wires) currently relies on
  `alphaTest 0.5` with `transparent` — flag-driven changes apply ONLY to flagged defs so the tuned
  look elsewhere cannot regress.
- **Sway vs instancing:** the offset must be stable per instance (phase from the instance matrix
  translation, available in the vertex shader under `USE_INSTANCING`) — no per-frame attribute
  updates.
- **SSAO:** additive/no-depth-write materials still render into the NormalPass with override
  material; if glow cards pollute AO like the coronas did, move them to `GLOW_LAYER` (the
  established escape hatch, memory `ssao-glow-layer`).

## Out of scope

Gameplay flags (breakable glass/statues, garage doors, damageable props, tags), the wet-road
effect, flyer collision, per-flag debug UI.

---

## Iteration 4b addendum — wind weights live in the ASSETS, not the flags

The IDE veg bits cover only a fraction of vegetation (bushes/palms). The real should-sway
set
(`static/wind/` = 312 unadapted originals, the user's ground truth) is driven by *
*wind-ADAPTED
DFFs** in `static/img/gta3`: the day-prelit **ALPHA channel encodes per-vertex sway weight
**
(verified byte-level: Cedar1_hi canopy `0xFF→0xAA` ≈ 0.33 weight, DEAD_TREE_1 `0xFF→0xDC` ≈
0.14;
trunks stay 255 = rigid). Implementation: `buildClumpParts` emits a `swayWeight`
attribute +
`RenderPart.swayAlphaMin`; `applyWorldWindSway` gained a `weight` mode; build-region triggers
it
when `swayAlphaMin ≥ SWAY_ALPHA_FLOOR (64)` (rejects fade-to-transparent gradients, which
drop
toward 0), with the IDE-flag height mode as fallback. Coverage audit:
`scripts/wind-coverage.ts`
(weight-covered / flags-only / MISSING / false positives).

### FUTURE: authoring weights for unadapted models

`vgsEflgs1_lvs` (casino flags, vegasE.ide flags 128) **should** flutter but the source mod
never
adapted it: all 1001 prelit alphas are 0xFF and it carries no veg IDE bits — so it correctly
does
not sway today. When wanted, the clean fix is to author weights ourselves rather than
name-keyed
hacks: a `scripts/adapt-wind.ts` that opens a DFF, selects vertices **by material/texture** (
flag
cloth vs pole) and writes the chosen alpha (e.g. 0x99 ≈ 0.4 for cloth), saving the adapted
copy
into `static/img/gta3` — the existing weight rule then picks it up with zero renderer changes.
The
same tool covers any other MISSING entries from the coverage audit.

## Follow-up (done): NO_ZBUFFER_WRITE restricted to alpha materials

`NO_ZBUFFER_WRITE` (0x40) is now applied (`depthWrite=false`) **only to transparent materials**, not
opaque ones (`applyTreatment` gates on `material.transparent`). Why: big countryside/desert/Vegas
TERRAIN tiles ship a bare 0x40 (e.g. `VegasSland40`, `cuntwland54b` — flags 64, opaque DXT1). SA's
`VisibilityPlugins.cpp` disables z-write for ANY 0x40 model (incl. that terrain) + sets
`ALPHATESTFUNCTIONREF=0`, but it only looks right under SA's fixed chase camera; with our free / orbit
/ top-down camera a non-z-writing opaque ground can't occlude overlapping tiles, so the painter order
flips with the angle → angle-dependent see-through holes. Genuine decals/shadows/glass that actually
need no-z-write always also carry DRAW_LAST (e.g. `grnd_alpha*` 2097348, `des_rdalpha*`/`trackshad*`
68), so they're transparent and keep the behaviour. The flag parse/mapping is unchanged — only the
application is gated. (Confirmed user fix: deleting the unconditional `depthWrite=false` removed the
artifact; this is the precise version.)
