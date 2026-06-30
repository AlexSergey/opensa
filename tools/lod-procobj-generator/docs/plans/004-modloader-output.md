# 004 — `--modloader` output (rename `--loose`)

**Status: ✅ Implemented (P1–P2b); in-game verify (P3) pending.** Replace the `--loose` flag with **`--modloader`**: instead of a repacked `gta3.img` (+ a
patched `data/gta.dat`), emit **two Modloader mods** under `<out>` — `lod/` (LODs + static IPL + stripped
`procobj.dat`) + `hd/` (the swapped HD models via a `txdp` IDE). Loose model files Modloader injects into `gta3.img`
by name; `loader.txt`s carry the gta.dat lines (no `gta.dat` edit); neither rewrites a stock IDE. Target is the
**real game's `modloader.asi`** (`./2` "Project Props" for the loader format, `./5` "BSOR Vegetation" for `txdp`).

> **The generation is unchanged.** What models/textures/collision/placements get produced is identical — only the
> **emit/packaging layer** changes (which files, which folders, `loader.txt` vs `gta.dat` patch). This is an
> output-format plan, not an algorithm change.

## Reference format (from `./2/Project Props 1`)

```
<mod>/
  loader.txt                 # gta.dat-style lines, GAME-virtual paths (Modloader resolves files by *name*)
  maps/WelcomeSigns.ipl      # placements
  WelcomeSigns.ide           # object defs   (loader.txt says `IDE data/models/WelcomeSigns.ide`)
  WelcomeSigns.col           # collision     (loader.txt says `COLFILE 0 data/models/WelcomeSigns.col`)
  models/*.dff, *.txd        # streamed models — injected into gta3.img by bare filename
```

`loader.txt`:

```
IPL data/maps/WelcomeSigns.ipl
IDE data/models/WelcomeSigns.ide
COLFILE 0 data/models/WelcomeSigns.col
```

The on-disk paths need **not** match the `loader.txt` paths — Modloader injects/serves every `.dff`/`.txd` by bare
name (any depth) and resolves IPL/IDE/COL by filename. So `loader.txt` mirrors what `gta.dat` would say; the folder
layout is for humans.

## Target layout for `--modloader` — TWO mods (`lod/` + `hd/`)

```
<out>/
  lod/                          # the LODs + placements
    loader.txt                  #   IDE + IPL (no COLFILE — col auto-discovered)
    gta3img/                    #   LOD .dff + lod_procobj.txd + lod_procobj.col → gta3.img by name
    data/maps/lod_procobj.ipl   #   the generated static IPL
    data/maps/lod_procobj.ide   #   object defs (our own — no stock IDE)
    data/procobj.dat            #   stripped (converted species removed)
  hd/                           # the swapped HD models (only with `--in`)
    loader.txt                  #   one line: `IDE data/maps/lod_procobj_hd.ide`
    data/maps/lod_procobj_hd.ide#   a `txdp` section: each swapped model's stock TXD → the custom parent TXD
    gta3img/                    #   swapped (prelit) HD .dff + the custom TXD → gta3.img by name
```

Modloader injects every `.dff`/`.txd`/`.col` into `gta3.img` by bare filename. **No `COLFILE`** — SA auto-discovers
the embedded `.col`. Neither mod rewrites a stock IDE.

## What changes vs current `--loose`

| Current `--loose`                                         | `--modloader`                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| one `gta3img/` folder (all changed entries)               | one `gta3img/` (same — `.dff`/`.txd`/`.col`)                                                    |
| `data/gta.dat` **patched** with the new IDE/COLFILE lines | **`loader.txt`** with `IDE` (no COLFILE — col auto-discovered)                                  |
| edited stock files written under `data/` / `models/`      | edited stock files shipped as **name overrides** in `gta3img/` (Modloader replaces by filename) |

## Placement + HD swap

Unlike lod-trees, procobj has **no mode-A/B split**: its LODs are inherently **new** standalone static-IPL
placements (procobj scatter has no stock static IPL to attach to), and `convertProcObj` also **strips
`procobj.dat`** so the runtime scatter stops — there's no near-field double-draw to avoid. So `--modloader` just
packages that same output (loose `gta3img/` + `loader.txt`).

**HD shipped as a separate `hd/` mod via `txdp` (revised — matches lod-trees `008`).** The HD models carry our
prelight, so we don't drop them. But the `--in` swap + retxd rewrites the swapped models' **stock IDEs** (to repoint
their TXD), which Modloader would fully replace — fragile. Fix (the `./5` approach): ship the swapped (prelit) HD as
a **separate `hd/` mod** that adds a **`txdp` section** (`<stock txd>, <custom txd>`) instead of editing the stock
IDE — the stock TXD inherits any missing texture from the custom parent. Built by `txdpSwappedModels`
(`@opensa/map-placement/retxd`). The `lod/` mod keeps the decimated LODs + static IPL + stripped `procobj.dat`.
`--out` keeps the inline IDE-repoint swap. Result: under `--modloader` the output has exactly **two IDEs, both ours,
zero stock IDEs**.

## Open decisions (resolved)

1. **procobj's current placement — resolved.** `lod-procobj` already places via `convertProcObj` (`@opensa/map-placement/procobj`):
   it emits a **standalone static `lod_procobj.ipl`** (HD instance → its decimated LOD, HD→LOD `lod` links _within
   that generated IPL_) and strips the species from `procobj.dat`. It **edits no stock IPL/binary stream** — so it
   is already effectively mode B for _both_ outputs. `--modloader` therefore needed only the packaging swap
   (`loader.txt` + single `gta3img/`), not a placement rewrite. `loader.txt` carries `IDE` always and `IPL
data/maps/lod_procobj.ipl` whenever any species was converted; no `COLFILE` (col auto-discovered).

(Also resolved: single `gta3img/` for `.dff`/`.txd`/`.col`; no `COLFILE` line — SA auto-discovers the embedded col.
A for `--out`, B for `--modloader` — though for this tool A and B share the same self-contained placement.)

## Scope: real game now, OpenSA next stage

`--modloader` targets the **real game's `modloader.asi`** (the `./2` format). OpenSA's own `packages/modloader`
currently only overrides `.dff`/`.txd` — it does **not** read `loader.txt`/IPL/IDE/COLFILE, so these mods' _defs and
placements_ wouldn't load in OpenSA yet. **Next stage** (separate plan): extend `packages/modloader` to read
`loader.txt` + virtualize IPL/IDE/COL so the same `--modloader` output also works in OpenSA.

## Phasing

- **P1 — flag + emit folder. ✅** Renamed `--loose` → `--modloader` (`cli.ts` usage + var, `build.ts`
  `BuildOptions.modloader`, readme). In modloader mode the `emitImg` loose path writes the changed entries
  (HD .dff + LOD .dff + `lod_procobj.txd` + `.col`) into a single `gta3img/`.
- **P2 — `loader.txt` + data. ✅** Extracted `emitRegistration` (`build.ts`): in modloader mode it writes
  `loader.txt` (`IDE data/maps/lod_procobj.ide` + `IPL data/maps/lod_procobj.ipl` when any species converted, no
  `COLFILE`) and drops the gta.dat patch; otherwise patches `data/gta.dat` as before. Verified on `non-modified`:
  48 species → `gta3img/` (48 LOD DFFs + `lod_procobj.txd`/`.col`), `loader.txt` (IDE+IPL), `data/maps/lod_procobj.{ide,ipl}`,
  stripped `data/procobj.dat`, **no** `data/gta.dat`. Lint clean, 5 tests pass.
- **P2b — `lod/`+`hd/` split, HD via `txdp` (revised — HD no longer dropped). ✅** `run` (`build.ts`) writes the LOD
  mod under `<out>/lod/` (convertProcObj, IDE, IMG entries, loader.txt) and calls `emitHdMod` → `<out>/hd/`: the
  swapped (prelit) HD DFFs + custom TXD → `hd/gta3img/`, a `txdp` IDE (`lod_procobj_hd.ide`) via
  `txdpSwappedModels`, a one-line `loader.txt`. Verified on `non-modified` + vegetation pack: `lod/` (48 LOD DFFs +
  txd/col + IPL/IDE + stripped `procobj.dat`) and `hd/` (48 HD DFFs + `vegetation.txd` + `txdp` IDE). **Two IDEs
  total, both ours, zero stock IDEs.** Mirrors lod-trees `008`.
- **P3 — in-game verify** (real `modloader/` install, pending) + update `005`/`003` asset-format notes if the
  packaging surfaces any new SA-strict gotcha.

## Relationship

- Mirrors **lod-trees-generator 008** (same `--modloader` packaging for the sibling tool; share the emit helper if
  it's clean to extract — both already share `@opensa/sa-lod`).
- `003-sa-asset-format.md` — the SA-strict invariants still apply (Modloader changes packaging, not the bytes).
