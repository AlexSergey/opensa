# 037 — Sanitize stored vertex normals (zero / non-finite)

## Symptom

On the `gta3` (Proper Fixes) archive, the Casino Royale building renders **almost entirely black
**
(`casroyale02_lvs` / `casroyale04_lvs` @ 2111.3, 1501.1, 22.1), while `casroyldge01_lvs` next to
it
is fine. The stock `gta3original` models are all fine.

## Root cause (verified byte-level)

The PF re-export of `casroyale02/04_lvs.dff` sets the `NORMALS (0x10)` geometry flag and stores
a
normals block — but **~81% of the normals are exact zeros** (the rest are valid,
byte-quantized).
A zero-length normal yields no diffuse term (`normalize(0)` is undefined in the shader) → the
face
renders pure black under our dynamic sun. Everything else checks out: prelit colours are light
and
sane, texture names resolve in both TXDs (DXT1), triangle counts match the original.

- `casroyldge01_lvs` is fine because it has **no** NORMALS flag at all → it takes
  our
  computed-normals path, which already runs `sanitizeDegenerateNormals` (plan 001 since-add).
- Real SA never notices: its static-world pipeline (`CCustomBuildingDNPipeline`) ignores
  vertex
  normals entirely (prelit-only lighting), so PF ships garbage in data SA never reads — same
  family
  as the trafficlight1 mixed-winding case (plan 004 since-add, IDE flag 0x200000).

## Fix

Run `sanitizeDegenerateNormals` on **stored** normals too, not just computed ones, and harden
its
zero check against non-finite values:

- `three/build-clump.ts`:
  - `sanitizeDegenerateNormals`: treat a normal as bad when
    `!Number.isFinite(len²) || len² < 1e-8`
    (NaN/Infinity would slip past the `< ε` comparison alone).
  - `buildGeometry` (stored-normals branch) and `vertexNormalAttribute` (stored branch,
    feeds
    `buildClumpParts`/instanced map): sanitize `rw.normals` before wrapping it in the attribute.
- In-place on the parsed array (lives in the clump cache) — the repair is **idempotent** (zeros
  are
  replaced once; a second pass finds nothing), so mutating the cached clump is safe.

## Why this is low-risk (analysis)

Only exact-zero / non-finite normals are touched — and those are *always* broken today (black).
A "legitimately zero" stored normal does not exist: SA's map pipeline never reads normals, so
zeros can only be exporter garbage. Stock archives have valid normals everywhere → scan early-returns,
no visual change. Residual imperfections on the dirtiest assets (accepted): inward-facing repairs
where the winding is also mixed (lit from the wrong side → blotchy, not black), and flat shading
at corners (one incident face's normal) — same trade-offs the computed path has shipped with since
the black-roads fix.

## Tests

- Real-asset regression case `tests/dff/casroyale-zero-normals/` (`casroyale02_lvs.dff` from PF),
  in `build-clump.test.ts`:
  - negative: the parsed DFF *does* contain zero-length stored normals (documents the broken input);
  - positive: after `buildClump`, no zero/non-finite normals remain in the attribute.
- Synthetic: stored NaN normals are repaired (the new finiteness guard).
- Existing suites stay green (`build-clump`, `build-clump-parts`, vehicles).

## Out of scope

- Winding repair (orientation propagation) — only needed if blotchy inward-lit repairs on
  dirty PF meshes turn out to matter visually.
- The SA prelit lighting rework (unlit map, day/night prelit blend, dynamic-only sun +
  shadows) — planned separately (next plan); this sanitizer stays useful there for dynamic objects.
