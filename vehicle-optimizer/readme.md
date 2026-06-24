# vehicle-optimizer

A standalone tool for **fitting vehicle models**. Two operations, usable together in one run:

1. **Uniform scale** — `--scale 1.1` grows the whole vehicle 10%: geometry (incl. `chassis_vlo` + `_ok`/`_dam`
   damage parts), the **dummy rig** (wheels / doors / seats / lights — scaled _with_ the geometry so nothing
   shifts and there's no gap when a door opens), and **collision**. It does **not** touch data files
   (`vehicles.ide` / `carcols` / `handling.cfg`).
2. **Material-effect copy** — `--prototype <reference>` copies only the **reflection / specular / env-map**
   material effects from a perfectly-tuned reference model onto the target.

Output is **standard RenderWare DFF/COL**, so it works in the **real game** — this module is independent of the
OpenSA engine (it never touches `../src` beyond reusing its read-only RW parsers).

## Usage

`--model` is a **path to a loose `.dff`, resolved relative to `src/cli.ts`** (same for `--prototype`).

```bash
# inspect a vehicle DFF (structure + which materials carry reflective effects):
npx tsx vehicle-optimizer/src/cli.ts --model ../../tests/original/dff/vehicle/infernus.dff

# scale +10% (and, later, copy reflective effects from a reference) → vehicle-optimizer/out/infernus.dff:
npx tsx vehicle-optimizer/src/cli.ts --model path/to/infernus.dff --scale 1.1 --prototype path/to/elegy.dff
```

```
vehicle-optimizer — infernus
  geometry  — 7 parts, 5421 verts, 8123 tris
  rig       — 28 frames (24 named dummies)
  materials — 19 total, 11 with reflective effects
    vehicleenvmap128 — env+refl
    ...
```

Today only `inspect` is implemented; `--scale` (plan 002) and `--prototype` (plan 003) are stubbed.

## Layout

```
vehicle-optimizer/
  src/
    cli.ts                 # --model <path> [--scale] [--prototype <path>]   (paths relative to cli.ts)
    core/                  # game-agnostic: VehicleAdapter contract (byte-based), report
    adapters/gta-sa/       # RenderWare adapter — reuses ../src parsers READ-ONLY; writers live here / reuse map-optimizer
  docs/plans/              # 001 architecture, 002 scale, 003 material-effect copy
  out/                     # processed DFFs (gitignored)
```

## Principles

- **Never modify `../src`** — read-only reuse of the RW DFF/COL parsers; all writers live here (or reuse the
  sibling `../map-optimizer` RW codec).
- **Real-game output** — standard RenderWare, no OpenSA-specific data; not coupled to the engine.
- **Game-agnostic core + per-game adapter** — a new game is a new adapter.
