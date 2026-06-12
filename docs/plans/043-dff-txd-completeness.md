# 043 — DFF/TXD parsing completeness vs the SA spec

## Context

Full-coverage audit (`scripts/audit-rw-coverage.ts`, 2026-06-12) over every extracted model:
**13126 DFFs — 0 parse failures**; **22705 TXD textures — 36 dropped (0.16%)**. The parser is
robust; the remaining gaps are below, prioritized by what the DATA actually contains (chunk
histogram + full 2dfx census) rather than by spec completeness for its own sake.

Audit highlights:

| Chunk | Count | Status |
| --- | --- | --- |
| ExtraVertColour (night prelit) | 11978 | parsed |
| HAnimPLG | 10948 | NOT parsed (we bind bones by frame name) |
| MaterialEffects / SpecularMat / ReflectionMat | 10873 / 8100 / 16459 | parsed (env path) |
| Breakable `0x253F2FD` (gtamods-confirmed) | 1724 | NOT parsed |
| 2dEffect | 1670 chunks | types 0+7 parsed, see census |
| SkinPLG / CollisionModel | 342 / 214 | parsed |
| UVAnimDict/PLG | 20 / 32 | parsed |
| PipelineSet | 27 | NOT parsed (we derive materials ourselves) |
| MorphPLG | 0 | N/A — absent from data |
| Multi-UV-layer models | 316 | 2nd layer parsed but unused by the renderer |

2dfx census (all entries, byte-accurate): type 0 lights **1664** (done), 1 particles **113**,
3 ped attractors **820**, 4 sun glare **2**, 6 enex **75**, 7 roadsigns **516** (done),
8 trigger **30**, 9 cover points **13900**, 10 escalators **6**.

## Iterations

1. **TXD 16-bit rasters — DONE (2026-06-12).** `expand16` in txd.ts decodes R5G6B5 / A1R5G5B5 /
   A4R4G4B4 to RGBA8888 at parse (same expansion path as the palettes; depth-16 branch in
   readMipmaps). Synthetic tests for all three layouts (single-pixel bit-exact) + a new
   genuinely-unsupported negative (LUM8). **Verification surprise:** the audit's dropped count
   stayed at 36 → shipped data contains NO 16-bit textures; the fix is spec-correctness for
   modded TXDs. The 36 residuals are most likely the audit's crude `countNatives` byte-scan
   miscounting (0x15 patterns inside texture data) — refine the audit to walk the real chunk
   tree if the number ever matters.

2. **Breakable plugin (`0x253F2FD`, gtamods-confirmed, ×1724) — MOVED OUT (user decision):**
   breakables get their own dedicated plan later (parse + gameplay together).
   Unknown chunk identification — RESOLVED via the wiki section list: `0x1F` = **Right To
   Render** (per-atomic/material pipeline hint, ×56k, harmless skip), `0x12` = RW core
   **Light** sections in clumps (×912; SA ignores them — lighting is prelit + 2dfx),
   `0x253F2FB` = GTA HAnim (zero in our data), `0x253F2F5` = TexDictionary Link.

3. **2dfx type 1 particles + type 10 escalators — MOVED OUT to plan 044 (world effects):** they
   need an emitter/animation system behind the parsing, so they live in their own plan with the
   full effect-name survey (113 particle entries across 13 distinct effects, 6 escalators).

5. **Multi-UV layer usage (316 models).** Investigate what the 2nd UV set drives in SA (dual-pass
   MatFX dirt/detail overlays on roads is the prime suspect — pairs with the MaterialEffects
   dual-texture subtype we currently skip). If confirmed visual: plumb `uvLayers[1]` through
   `buildClumpParts` + a `|dualPass` material variant. Audit first with a small script listing
   which models/textures use it.

6. **HAnim PLG (10948 chunks).** Parse bone ids/hierarchy; switch IFP→skeleton binding to bone
   IDs when present (frame-name binding stays the fallback). Low visual impact (names work for
   shipped data) but removes a whole class of modded-ped fragility.

## Explicitly N/A (documented, not planned)

- 2dfx type 3 ped attractors (820) — no peds/AI yet; type 8 trigger (30), type 9 cover points
  (13900) — gameplay AI data; type 4 sun glare (2) — negligible; type 6 enex (75) — interiors
  are out of scope.
- PipelineSet (27) and Right To Render (×56k) — render-pipeline hints; our material derivation
  already matches the result.
- RW core Light sections in clumps (×912) — SA never uses them (prelit + 2dfx lighting).
- MorphPLG — zero occurrences in shipped data.
- UV-anim rotation/skew — parsed but unapplied; no shipped asset animates them.
- Vanilla `Breakable` GAMEPLAY (smashing) — only the parse side is in scope above.

## Verification

Re-run `scripts/audit-rw-coverage.ts` after each iteration: dropped-texture count → 0 (iter 1),
unknown-chunk list shrinks (iter 2); in-browser checks per feature (fountain at the Strip,
escalator in SF); `npm test` with new fixtures per parser addition.
