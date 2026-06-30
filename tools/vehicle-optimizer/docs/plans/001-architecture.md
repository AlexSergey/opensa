# 001 — vehicle-optimizer architecture

**Status: ✅ Base scaffolded (inspect runs).** A standalone tool for fitting vehicle models — **uniform scale**
and **reflection/specular/env-map copy** — kept separate from map-optimizer (map conditioning) and opensa-lod-generator
(distant LODs) because it's a focused, custom **vehicle** tool whose output must run in the **real game**.

## Why a separate project

The output is standard RenderWare DFF/COL for **real GTA SA** (not OpenSA-specific), and the operations are
vehicle-domain edits (scale a rig, copy material effects). It reuses the shared RW codec but answers to a
different goal than the map tools, so it lives on its own with its own `out/`.

## Shape (mirrors map-optimizer / opensa-lod-generator)

```
cli.ts  --model <path> [--scale <factor>] [--prototype <path>]  →  out/<filename>.dff   (paths relative to cli.ts)
  core/        game-agnostic: the VehicleAdapter contract + the structure report
  adapters/    per-game I/O behind VehicleAdapter; gta-sa reuses ../src RW parsers READ-ONLY
```

**`VehicleAdapter`**:

- `inspect(model)` — parse + report parts / frame rig (dummies) / materials with effects. **Implemented**
  (read-only `parseDff`).
- `process(model, { scale?, prototype? })` — produce the finished DFF (+ collision): uniform scale (plan 002)
  and/or copy reflective effects from `prototype` (plan 003). **Stubbed** until those land. Both ops compose in
  one call.

## Principles

- **Never modify `../src`** — read-only reuse of the RW DFF/COL/material parsers; every writer lives here or
  reuses the sibling **`../map-optimizer`** RW chunk + geometry codec (its byte-faithful serializer is what keeps
  the output valid for the real game).
- **Real-game output** — standard RenderWare, independent of the OpenSA engine (no engine change, no
  OpenSA-only data).
- **Game-agnostic core, per-game adapter** — GTA-SA specifics stay in `adapters/gta-sa`.
- **Data files are out of scope** — `vehicles.ide` / `carcols` / `handling.cfg` are never touched (per the
  request); only the visual DFF + collision.

## Status

`inspect` validates the read path (parts, frames/dummies, material effects). `process` throws until plans 002
(scale) and 003 (material-effect copy) land, so the CLI can't silently emit an unprocessed model.
