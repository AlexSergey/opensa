---
name: ipl-interior-area-code
description: GTA SA IPL interior/area-code rule — real id = value & 0xFF; exterior = id 0 or WORLD_INTERIOR_IDS {13}; isInterior helper
metadata:
  type: reference
---

**Rule (derived from a full per-code IPL audit, 2026-06).** The GTA SA IPL `interior` field is an **area code**, not a plain interior id. The real interior / render-level id is the **low byte**: `interiorId = value & 0xFF` (high bits are masked off, e.g. `1024→0`, `1030→6`, `269→13`). But `id === 0` alone is NOT the full exterior test — one non-zero id is also open world. Final rule:

```
isInterior(value) = interiorId(value) !== 0 && !WORLD_INTERIOR_IDS.has(interiorId(value))
WORLD_INTERIOR_IDS = { 13 }   // open-world render-level ids that are non-zero
```

Implemented in `src/renderware/parsers/text/interior.ts` (`interiorId`, `isInterior`); used to filter placements in `buildWorldGrid` (render grid → collision streams off it) and `buildColliders` (Show Collision). HD grid ~38.8k → ~39.1k after adding id 13; vs the old over-strict `interior !== 0` (~30.8k). See [[binary-ipl-render-approach]].

**Per-code audit (all IPLs, model types + spatial spread + Z):**

- **Exterior** — id `value & 0xFF` is `0` (codes 0, 256, 512, 768, 1024, 2048, 2304, 4096, 6144 — all multiples of 256) OR **`13`** (codes 13, 269 (=256+13), 2317 (=2304+13)). These sit at ground-level Z and carry world geometry: ground/roads, traffic, street lights, fences, trees, freeway (`GSFreeway*_LAn`), rail tunnels (`RailTunn*`). Examples: `wattspark1_LAe2` interior=1024 → id 0; `lae2_ground08` interior=13 → id 13.
- **Hidden interior** — ids `1, 3, 4, 6, 7, 10, 14, 15, 16, 17, 18` (the "interior universe", clustered at Z ≈ 1000): slot-bank, sex-shop (`CJ_SEX_*`), 7-11 (`int_7_11*`), airport (`CJ_AIR*`), stadium, `DYN_TABLE`/`CJ_*` props.

**Why a curated allowlist, not a heuristic.** A naive "the code contains a ground/road model" check is UNRELIABLE — the 7-11 interior (id 4) contains a model named `dirtstad`, which a `/dirt/` regex would falsely flag as world. The clean, audited result is that **13 is the only non-zero world id**, so `WORLD_INTERIOR_IDS = {13}` is a small, explicit set. If another world id surfaces in-game (an interior code whose objects should be visible in the exterior), add it to that set; re-run the per-code audit script (parse all text + binary IPLs, bucket instances by `interior`, print model samples + Z range + spatial span).

**Validated 2026-06:** with `id 0 or in {13}` the user swept the whole map via the debug section inspector and saw **no render holes** — the rule holds in practice, not just on paper. (Revisit only if a future model surfaces that should be exterior but is hidden.)

History: started as `interior !== 0` (too strict, dropped ~9.5k exterior objects); then `value & 0xFF !== 0` (still wrongly hid id 13 = `lae2_ground08`); now `id 0 or in {13}`. The standalone viewer (`/viewer.html`, [[prelit-darkness-and-model-viewer]]) renders any model ignoring interior — use it to confirm a model's look independent of this filter.
