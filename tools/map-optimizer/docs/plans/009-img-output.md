# 009 — Pack the output into a VER2 `.img`

**Status: ✅ Implemented** (output later superseded by the full-build clone — see [011](./011-full-build-output.md)).
The input is a GTA `.img` archive, so the output should be one too. On `finalize` the GTA-SA adapter packs every
optimized model into a stock **VER2 `<game>.img`** under `--out`, making the result drop-in usable instead of a
loose pile of `.dff` files.

## Context / problem

The tool resolved models out of `models/*.img` and wrote optimized **loose `.dff`** files. That's fine for
inspection, but the game loads `.img` archives — to actually use the output you'd have to repack it by hand.
The output should mirror the input's packaging.

## Decisions

- **VER2 `.img` on `finalize`.** The adapter accumulates each optimized `{ name, bytes }` during `write()` and,
  in `finalize(outDir)`, packs them into `<out>/<game>.img` (entries sorted by name for a deterministic
  archive).
- **Reuse the engine's tested packer.** `buildVer2Buffer` already exists in `../src/renderware/archive` (it's
  what `test-fixtures` uses); the adapter imports it **read-only** — same as it reuses `parseDff` /
  `openArchive`. IMG packing stays inside the GTA-SA adapter (the per-game seam), so another game's adapter can
  use its own format.
- **Keep the loose `.dff`s too** — handy for diffing/inspection; the `.img` is the deployable artifact.
- **Contents = the successfully optimized set.** Models that failed (missing from the source archives, or a
  rebuild guard like skin/multi-UV) aren't in the `.img`; deploy it as an override on top of the original
  archive so anything absent falls back.

## Module changes

- **`src/adapters/gta-sa/index.ts`**: accumulate optimized models in `write()`; add `finalize(outDir)` that
  writes `<game>.img` via `buildVer2Buffer`.
- **`readme.md`**: document the `.img` output.

## Scope

- **In:** VER2 `.img` packing of the optimized models on finalize; deterministic order; README.
- **Out (later):** including original bytes for guard-failed models to make a fully self-contained replacement
  archive; WIMG output; splitting very large archives.

## Risks / testing

- **Format fidelity:** `buildVer2Buffer` is already unit-tested in the engine; the produced `gostown.img` was
  validated by re-opening it with `openArchive` — **836/836 entries parse** as DFFs and each entry's
  (sector-padded) bytes match the loose `.dff` on its meaningful prefix, with whole-sector alignment.
