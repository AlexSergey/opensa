# 012 — Condition prelit vertex colours (fix too-dark / too-bright)

**Status: ✅ Implemented** (`plugins/condition-prelit.ts`, in the default pipeline). The implementation uses an
**additive luma shift** (mean → `targetLuma`, default 200) rather than the multiplicative scale the draft
sketched: the shift lifts a flat-black model cleanly to a neutral and preserves the **absolute** AO spread
without the contrast blow-out a large multiplicative factor would cause. Conservative defaults: `darkThreshold
24`, `brightThreshold 248` (near-black / near-white only). Alpha is copied byte-for-byte.

**Dark rescue is gated on near-uniformity** (`maxDarkSpread`, default 16): only _flat_ near-black prelit is
lifted. An early version lifted **any** model with mean < 24, which **washed out deliberately dark, structured
models** — e.g. `vgEplntr01_lvs` (mean 10.9, spread 95: real baked shading) got `+189`'d and clamped toward
white. Adding the guard dropped the day-conditioned count from ~600 → 321 on stock `original` (the extra ~280
were structured-dark models that should never have been touched). Still gated on **in-game** A/B calibration
of `targetLuma`.

The SA map is **prelit** — the engine multiplies the texture by each vertex's
baked prelit colour (plan 038, the unlit world material). Mod re-exports frequently ship prelit that's
**all-black** (the model renders ~invisible) or **blown-white** (fullbright, flat, ignores the lighting). This
plugin detects those pathological extremes and pulls them back to a neutral level **while preserving the baked
AO** on healthy models. Attribute-only (vertex count unchanged), so it rides the existing serializer.

## Context / problem

`build-clump.ts` builds the **unlit SA world material**: day prelit RGB is the base shade, blended day↔night.
So a model with all-black day prelit renders black, and one with all-255 prelit renders fullbright (no shading,
clashing with its neighbours). Both are common export bugs. We want to fix the **extremes** without flattening
Rockstar's baked ambient occlusion on the (majority) healthy models — the idea note is explicit that blanket
"make prelit uniform" looks **worse**.

## Hard constraint — never touch prelit ALPHA

Confirmed in `build-clump.ts`: the **day-prelit alpha is overloaded** — vegetation **wind sway weights** (plan
039), **floodlight beam cones**, and night/road overlays all live there. The plugin conditions **RGB only** and
copies **alpha verbatim**. (The IR keeps the full RGBA; we rewrite only the RGB bytes.)

## Decisions

- **Day prelit only.** The `Struct`'s `prelitColors` (RGBA). The night set (`NIGHT_VERTEX_COLORS`) is a separate,
  lit-window-nuanced concern — out of scope here.
- **Detect per geometry** from the prelit RGB: mean **luma** and its spread.
  - **Too dark** (`meanLuma < darkThreshold`): if near-uniform (no usable AO) → **fill** with a neutral target
    grey; if it has variation → **scale RGB** so the mean hits the target, **preserving relative contrast** (the
    baked AO).
  - **Too bright** (`meanLuma > brightThreshold`): **scale RGB down** to the target, preserving contrast.
  - **Healthy** (mean within range) → **left untouched** — never flatten good AO.
- **Preserve hue.** Scale RGB **uniformly** by the luma ratio (not per-channel), so tinted prelit keeps its tint.
- **Target = configurable neutral luma**, defaulting to the level the engine's plan-038 material renders a
  texture ~unmodulated at (calibrated in-game). Deriving the target from the **corpus median** of healthy map
  models (so the whole map's prelit is consistent) is a noted enhancement.
- **Only geometries that already have prelit** (PRELIT flag). Adding prelit to prelit-less models is a separate
  "fill" task (different — it needs an AO source), out of scope.
- **Attribute-only → no codec work.** Plugin mutates `mesh.prelitColors` RGB; `applyMeshToStruct` already writes
  prelit back (counts unchanged). Opt-in (it changes appearance).

## Module changes

- **`plugins/condition-prelit.ts`** (new): pure `conditionPrelit(prelit, opts)` (RGB only, alpha copied) +
  `createConditionPrelit({ darkThreshold, brightThreshold, targetLuma, … })` factory.
- **`optimizer.config.ts`**: runs as the **last** default stage (after prune, so it sees the final prelit
  arrays). Conservative thresholds keep it safe on by default; `targetLuma` is still configurable per-run.

## Scope

- **In:** detect + fix too-dark / too-bright **day** prelit (RGB only, alpha preserved); the pure function +
  factory; configurable thresholds/target; unit tests; a real-run report of how many models were dark/bright/
  conditioned.
- **Out (later):** night-colour conditioning; adding prelit to prelit-less models; corpus-median target;
  AO synthesis from geometry/normals; per-vertex re-baking.

## Risks / testing

- **It changes appearance and can't be auto-verified here** — the real gate is **in-game** (an A/B toggle:
  conditioned vs raw). The whole design is conservative to limit damage: healthy models are untouched, contrast
  (AO) is preserved, hue is preserved, and only outliers move.
- **Alpha preservation is critical** (wind / floodlight / overlays) — a unit test asserts alpha is byte-identical
  after conditioning.
- **Target calibration** needs in-game tuning against plan-038 lighting; ship conservative thresholds + the
  toggle so it's safe to dial in.
- Determinism: pure, no RNG.
