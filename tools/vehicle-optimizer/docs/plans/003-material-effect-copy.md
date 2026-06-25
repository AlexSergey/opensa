# 003 — Reflection-strength transfer (env-map coefficient + reflection intensity)

**Status: ✅ Implemented (cascade matching, cross-vehicle).** (`adapters/gta-sa/copy-effects.ts`).
`--prototype <path>` transfers **only the reflection strength** — the env-map `coefficient` (+ optional
`reflection` intensity) — from a well-tuned reference onto a target whose reflection is overdone. We do **not**
copy materials/effects wholesale: textures, colour, geometry, and _which_ materials reflect are all left alone;
we only retune the numbers on the target's **existing** reflective materials. Worst case: a part a touch too
shiny/matte — never structurally broken.

**Why this shape.** Some mods crank the env-map coefficient to ~1 (mirror-like, garish); a tasteful model like
`walton` uses ~0.5. The goal is to copy _that number_, not the material. So the prototype is read with the
**engine `parseDff`** (read-only) — which means anti-rip-**locked** references like `walton.dff` work as the
"good" reference — and only its `coefficient`/`intensity` values are read. The target (a standard DFF being
fixed) is read+patched with map-optimizer's byte codec, writing the new floats straight into its env-map
(`0x120`, coefficient @ offset 8) and reflection (`0x253f2fc`, intensity @ offset 16) plugin chunks.

**Matching — cascade, cross-vehicle (no index lock-step).** Per target reflective material: (1) by shared base
**texture name** (common SA textures, body paint); (2) else the prototype's **representative** value (median
coefficient/intensity across its reflective materials); (3) if nothing matches, best-effort representative. No
count match needed — different vehicles just work; a non-reflective prototype/target throws a clear error.
Verified: `walton`→`infernus` retunes infernus's overdone coefficient `1` → walton's `0.5` (intensity →
walton's median `0.07`) with the reflective/total material counts unchanged, **with walton locked**; cross-count
`admiral`→`infernus` no longer throws.

## What's transferred (just two scalars)

Only the **reflection strength** values, read from the prototype's `RWMaterial.effects`:

- **env-map `coefficient`** — the main "mirror-ness" knob (the overdone case sets this near 1),
- **reflection `intensity`** — secondary, patched only when the target material already has a reflection plugin.

Textures (incl. the env-map texture reference), colour, UV scale/offset, specular, and geometry are **not**
touched, and no reflection is added to or removed from a material — we only overwrite these two floats on the
target's already-reflective materials. (Specular was considered and left out — coefficient + intensity cover the
"too shiny" case with the least blast radius.)

## The crux — matching across different vehicles

Reference and target usually differ in material count/textures, so there's no 1:1 index map. The cascade:

1. **By base texture name** — a target material whose base texture matches a prototype reflective material's
   takes that material's coefficient/intensity (shared SA textures, body paint).
2. **Representative fallback** — otherwise the prototype's **median** coefficient (+ median intensity) across its
   reflective materials. So "both are reflective" is enough to transfer the tasteful level.
3. **Best-effort** — if nothing matches, the representative still applies; a prototype/target with _no_
   reflective materials throws a clear error (nothing to copy / nothing to retune).

Only target materials that **already** reflect are touched, so matte parts stay matte and the material structure
is preserved.

## Reuse vs. new

- **Reuse:** `../src` DFF parser (`RWMaterial.effects`, read-only — for the tests/inspection); **`../map-optimizer`**
  chunk codec (outer tree down to each Geometry's Material List leaf) + its `writeRw`.
- **New (done):** a **material-aware chunk walker** (re-parses the Material List leaf into Material/Texture/
  Extension containers); **verbatim effect-chunk copy** (no re-encoding — the plugins, incl. MatFX's embedded
  env-map texture, are copied whole); the index matcher; the `process` prototype path.

## Risks

- **Matching** — the open question. MVP (texture name + body) covers common cars; unusual material setups may
  mis-match → a part too shiny/matte. Low blast radius (effects only), easy to inspect via `--model <path>`
  (the report shows which materials carry effects).
- **Extension writer** — must insert/replace the plugin chunks without disturbing the rest of the material
  Extension (UV-anim, etc.); validate by parse→copy→re-parse round-trip.
- **Env-map texture availability** — if the reference's env-map texture isn't in the target's TXD, the effect
  references a missing texture; keep the target's own env-map texture name when only copying coefficients, or
  ensure the standard `vehicleenvmap128` is present.
- **Verification** — in-game: target gains the reference's reflective look; matte parts stay matte.

## Scope

- **In:** copy reflection/specular/env-map by texture-name match + body fallback; strip effects where the
  reference role has none; combine with `--scale` in one run.
- **Out:** colour/texture/geometry; full material replacement; non-vehicle materials.
