# 011 — Full build output (clone game-src + rebuild archives)

**Status: ✅ Implemented.** Change the output from "just the optimized assets" to a **complete, drop-in
build**: `out/<game>/` mirrors `game-src/<game>/` entirely, with each `models/*.img` **rebuilt** so the
optimized entries are swapped in and **everything else is preserved** (vehicles, peds, interiors, all other
models/textures, data files, …). Point the game at `out/<game>/` and it just runs. The loose optimized
`.dff`/`.txd` are **kept** alongside it (handy for inspection).

## Context / problem

Today the run writes only what it touched — loose optimized `.dff`/`.txd` + a `<game>.img` containing the
optimized **subset**. That archive is missing vehicles, peds, and every model/texture outside the
map-optimization scope, so it isn't a usable install. We want the full game in `out`, with the optimized
assets dropped in place of the originals.

## Decisions

- **Mirror the whole game-src tree.** `out/<game>/` is a copy of `game-src/<game>/` (`data/`, `anim/`,
  `text/`, loose `models/` files, …) copied **verbatim** — except the model archives.
- **Rebuild each `models/*.img` in place.** For every source archive, iterate **all** its entries: an entry we
  optimized (a map model `*.dff` or a mipped `*.txt`/`*.txd`) is written with the **optimized bytes**; every
  other entry is copied **unchanged**. So `gta3.img` keeps its peds/vehicles/interiors and just gains the
  conditioned map assets. Reuses the engine's `buildVer2Buffer` (read-only), same VER2 format.
- **Per-archive, by name.** Swaps are matched against each archive's own entry list, so an optimized name that
  lives in `gta3.img` is swapped there and one in an override (e.g. `gostown6.img`) is swapped there.
- **The adapter emits the build on `finalize`.** It accumulates optimized bytes via `write()` /
  `optimizeTexture` (into `packed`) and `finalize(outDir)` produces the clone + rebuilt archives.
- **Keep the loose `.dff`/`.txd`** (the core still writes them) alongside the full build, for inspection. The
  old standalone subset `<game>.img` is dropped — superseded by the per-archive rebuilds inside the clone.

## Architecture (proposed)

```
finalize(outDir):
  for each file under game-src/<game>/:
     models/*.img   → rebuildArchive(src, optimized)  → out/<game>/models/<same>.img
     everything else → copy verbatim                  → out/<game>/<same path>

rebuildArchive(archive, optimized):
  entries = archive.names.map(name => ({ name, data: optimized.get(name) ?? archive.get(name) }))
  buildVer2Buffer(entries)
```

## Scope

- **In:** full game-src clone to `out/<game>/`; per-archive rebuild with optimized swaps + everything else
  preserved; adapter owns output (core no longer writes loose files); the run report still reports the
  optimized-asset size delta; a fixture-based test + a real `--game original [--textures]` sanity run.
- **Out (later):** a **streaming** VER2 writer (so a ~1 GB `gta3.img` isn't rebuilt fully in memory); delta /
  incremental builds; output to a single packed distributable; excluding interiors from the clone.

## Risks / testing

- **Memory:** `buildVer2Buffer` builds an archive in memory, so a ~1 GB `gta3.img` is held whole while
  rebuilding — fine on desktop (the stated target), flagged for a future streaming writer.
- **Disk:** a full clone is large (the original is GBs); `out/` stays gitignored.
- **Fidelity:** untouched entries must be byte-identical and the archive still parse — tested on a small
  fixture (rebuild → re-open: a swapped entry differs, an untouched entry is identical, the directory is
  intact) and sanity-checked by re-opening the produced `original.img` and parsing a sample.
- **Completeness:** failed/guarded assets (skinned models, unparseable TXDs) keep their **original** bytes in
  the rebuilt archive (they were never swapped), so the build is complete — unlike the old subset `.img`.
