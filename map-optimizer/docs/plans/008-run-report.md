# 008 — Run report: optimization stats + savings

**Status: ✅ Implemented.** Turn the reporting skeleton ([001](./001-pipeline-architecture.md)) into a real
report: per-model before/after **vertices / triangles / bytes**, run **totals** (size reduction, verts &
faces removed), and a machine-readable `report.json`. Lets you actually see — and judge — what the pipeline
does, without changing any optimization behaviour.

## Context / problem

The pipeline runs five transforms but the report only counts "models processed / changed / failed". You can't
tell how much was saved, which is exactly what decides whether a plugin earns its place (and the safe
boundary: further geometry plugins change appearance and can't be auto-verified). Surfacing the numbers makes
the tool's value measurable and the next decisions data-driven.

## Decisions

- **Capture cheap counts** the pipeline already has: vertices + triangles from the IR **before** plugins and
  **after**, and bytes from the source vs the written output. No extra parsing.
- **Pure `summarizeReport(report)`** computes the run totals (models, changed, failures, bytes before/after,
  vertices/triangles removed) — unit-testable, no I/O.
- **`printReport`** shows the summary (with a size-reduction %); **`writeReport`** drops `report.json` in the
  output dir for tooling/diffing.
- **No behaviour change** to the optimization — purely observability.

## Module changes

- **`core/report.ts`**: richer `AssetReport` (bytes/vertices/triangles before+after); `summarizeReport`
  (pure), `printReport` (now with totals), `writeReport` (JSON).
- **`core/pipeline.ts`**: capture before/after counts + byte sizes per asset.
- **`core/index.ts`**: export `writeReport` / `summarizeReport`.
- **`src/cli.ts`**: write `report.json` after printing.

## Scope

- **In:** per-asset + total stats; `report.json`; the pure summary + its test; wiring.
- **Out (later):** per-plugin attribution of savings; HTML report; in-game visual validation (the real gate
  for the appearance-changing plugins).

## Risks / testing

- Stats are deterministic counts — `summarizeReport` is unit-tested on a fixture report; no optimization logic
  changes, so the existing pipeline/serializer tests still hold.
