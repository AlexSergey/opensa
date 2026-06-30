# 004 — mod-installer: bake Modloader-style mods into the tree

**Status: ✅ Implemented (P1–P5); in-game verify pending.** Today mod-installer overlays a mod that **mirrors the game
tree** (`data/`, `models/`) plus an explicit `gta3img/`. This adds a second mode: **bake a Modloader-style mod** —
scattered files + a `loader.txt` that registers them — into a flat, stock-loadable `--out`. It does **on disk,
persisted** what `@opensa/modloader` does **in memory at runtime**; it reuses that package's pure merge logic
(`type:tool → type:engine` is allowed by the dep constraints). Implemented in `bake-mod.ts`
(`scanModloaderMod`/`bakeMod`), wired into `install`.

Reference mod (the bundle this was designed against — a local `--in`, not committed): the **SA Brightened Project**,
a 7-sub-mod bundle (Improved Night Windows, New Neons, Pre-lighting Fixes + Effects, Project Immerse-Yourself,
Project Lumos, reLIT, Map Textures Fix) — ~1693 `.dff`, 125 `.txd`, 16 `.ipl`, 15 `.ide`, 4 `.col`, 2 `.ifp`,
8 `.txt`, 1 `.cs`.

## What's in the bundle (and how it must bake)

| In the mod (any folder, any depth)                          | Examples                                                                | Bakes to                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| Loose `.dff`/`.txd`/`.col`                                  | `files/`, `Better PS2 Models/exterior/misc/`, sub-mod roots             | **injected into `out/models/gta3.img`** by bare name          |
| Binary stream `<area>_streamN.ipl`                          | (in `gta3.img/` folders, if any)                                        | injected into `gta3.img` by name                              |
| **Modified stock** `.ide`/`.ipl` (basename exists in `out`) | `LAn.ide`, `LAe.ipl` (full files; `LAn.ide` = stock's 277 lines)        | **overwrite the stock file in place**                         |
| **New** `.ide`/`.ipl` (declared by a loader, not in stock)  | `reLIT.ide`, `neonobj.ide`, `vtxcfix2dfxs.ide`, `vinelumination.ipl`    | write to the declared path **+ add the line to `gta.dat`**    |
| `txdp` IDE                                                  | `NightTxdp.ide`, `neonobj.ide`                                          | a vanilla SA IDE feature — just registered like any new IDE   |
| `object.dat` / `procobj.dat`                                | —                                                                       | **additive merge** into `out/data/...` (`mergeDataFile`)      |
| `surfinfo.dat` / `plants.dat`                               | `plants.dat` (BSOR-style)                                               | whole-file overwrite (index/format-sensitive)                 |
| Loader file (`.txt` with `IDE`/`IPL`/`COLFILE`)             | `loader.txt`, `Loader.txt`, **`to gta.dat.txt`**, a UTF-16 `Loader.txt` | parsed → **patch `gta.dat`** (not copied)                     |
| `.col` referenced by `COLFILE`                              | `relit.col`, `vtxcfix2dfxs.col`                                         | injected into `gta3.img` (SA auto-discovers embedded col)     |
| `.ifp`                                                      | `cn2_ringking.ifp`, `des_stmotsigbas1.ifp`                              | inject into the anim archive by name (target TBD — see Risks) |
| `.cs` (CLEO), prose `.txt`, `.ini`, `desktop.ini`           | `Illuminated Vinewood Sign.cs`, `. des_stwnbowl.txt`                    | **ignored** (out of scope)                                    |

## Runtime overlay vs. build-time bake (the core difference)

`@opensa/modloader` is a **VFS decorator**: it serves mod files by basename and merges `gta.dat`/data text in
memory; nothing persists, and the engine reads through the overlay (txdp resolved by the engine, `.col`
auto-discovered from VFS names, loose model files served by name because the VFS flattens IMG + loose).

Baking must instead produce a **concrete on-disk tree that a stock loader reads** (real SA, or OpenSA's plain VFS
without the decorator). So every overlay is **materialized**:

- new/modified **IDE/IPL/DAT text** → **written to disk** at the path the (patched) `gta.dat` references;
- loose **DFF/TXD/COL/IFP** → **injected into the binary archives** (stock SA reads models from `gta3.img`, not loose
  files) by name;
- **`gta.dat`** → **physically patched** with the loader's `IDE`/`IPL` lines (no runtime loader.txt reader);
- additive **`.dat`** and **`txdp`** IDEs are written like any data file.

So: **bake = flatten the Modloader overlay onto disk.** It also lets the same bundle ship as a pre-merged game (real
game without `modloader.asi`, or an OpenSA tree the loader ingests directly).

## Why the current overlay isn't enough

The simple overlay assumes the mod **mirrors the game tree** + an explicit `gta3img/`. A Modloader mod instead has
(a) **scattered** files that don't mirror the tree (so they can't be path-copied — they must be \*\*routed by basename

- type**), (b) a **`loader.txt`** that must be parsed and merged into `gta.dat` (not copied as a stray file), and (c)
  **additive `.dat`**, **UTF-16** loaders, and **content-detected\*\* loaders (`to gta.dat.txt`). None of that is the
  path-mirror model.

## Design — a "bake" mode in `applyMod`

**Detection.** A `--in` subfolder is a Modloader mod if its subtree contains ≥ 1 **loader file** (a `.txt` whose
content parses to ≥ 1 `IDE`/`IPL`/`COLFILE` directive — the same content-detection as `@opensa/modloader`, so
`readme.txt`/prose is excluded). Such a mod is **baked**; others keep the current path-overlay + `gta3img/` merge.
(A bundle like `SA Brightened Project` is one `--in` mod whose **sub**-folders each carry their own loader — the
scan walks the whole subtree, so sub-mod boundaries don't matter; later files win on a basename clash.)

**Per baked mod:**

1. **Scan** the subtree once (any depth), bucketing every file by extension into the same sets
   `@opensa/modloader` uses — `assets` (dff/txd/col/ifp/\_stream.ipl, by basename), `texts` (ide/text-ipl/dat, by
   basename), `dataMerges` (object/procobj.dat), loader refs (`parseLoader`, **BOM-aware** read for the UTF-16
   `Loader.txt`).
2. **Materialise text** onto `out`:
   - `out/data/gta.dat` ← `mergeGtaDat(stockDat, loaderRefs)` (append `IDE`/`IPL`, dedup). `COLFILE` → drop (col is
     injected into `gta3.img`, auto-discovered) — or add a `COLFILE` line if we keep loose col (decide once).
   - each `texts` entry → **resolve its destination**: if the basename already exists as a loose file in `out`
     → overwrite in place (modified stock IDE/IPL); else the loader declared its path (`IDE DATA\MAPS\reLIT.IDE`)
     → write there. (Build a `basename → path` index of `out` once.)
   - `object.dat`/`procobj.dat` ← `mergeDataFile` (additive); other `.dat` → overwrite.
3. **Inject archives**: `set` every `assets` entry into `out/models/gta3.img` by basename (the `mergeGta3Img`
   machinery, fed from the scattered set instead of a `gta3img/` folder); `.ifp` into the anim archive (target TBD).

The existing `gta3img/` folder convention (e.g. `Map Textures Fix/gta3.img/`) and plain path-overlay stay as-is.

## Reuse map (no new logic to invent)

- **`@opensa/modloader`** (allowed: `type:tool → type:engine`): `parseLoader` (IDE/IPL/COLFILE), `mergeGtaDat`,
  `mergeDataFile` + `ADDITIVE_DAT`, and the extension-bucketing rules (`scan.ts`). The bucketing currently scans a
  VFS; for the fs baker either (a) feed it a thin `AssetFileSystem` view over the mod dir, or (b) lift the
  pure rules into a small shared helper. The **merge** functions are already pure (string → string) and reuse
  directly.
- **UTF-16**: `@opensa/vfs`'s BOM-aware decode (or a tiny copy) — the bundle's Project Immerse `Loader.txt` is
  UTF-16 LE.
- **gta3.img**: `@opensa/tool-kit/archive/img` (already a dep).
- **basename → stock path**: a one-time walk of `out` (to find where a modified stock file lives).

## Out of scope

- **CLEO `.cs`** — confirmed out of scope (no CLEO runtime; the static IPL placement still bakes, the script doesn't).
- **2dfx / neon / light rendering** — an engine-capability question, not baking. The defs/placements bake; whether a
  given effect renders is the engine's job.
- **Cross-mod / sub-mod conflict priority** — last-wins (alphabetical), same as the simple overlay. No real
  Modloader-style priority ordering.
- **New object/vehicle id allocation** — mods ship their own ids (`reLIT.ide` 12004+, etc.).

## Risks / open questions

- **`gta3.img` size + streaming limits** — injecting 1693 `.dff` + 125 `.txd` bloats `gta3.img`; SA has archive +
  streaming-memory limits a baked-in mega-bundle can exceed. (The runtime overlay sidesteps this — it never grows
  the archive on disk.) Document; maybe cap / warn.
- **Text-IPL ↔ binary-stream LOD-index coupling** ([`ipl-lod-index-coupling`]) — overwriting a stock text IPL while
  keeping stock binary streams only stays correct if the mod **appended** (didn't reorder/insert mid-list). Same
  caveat as the runtime overlay; the mod author owns it.
- **`COLFILE` vs embedded col** — pick one (inject into `gta3.img` = auto-discovered, simplest; or add `COLFILE`
  lines). Don't do both.
- **`.ifp` target** — confirm where a stock/OpenSA tree reads zone-object IFP from once baked (gta3.img vs anim.img).
- **Destination ambiguity** — a basename present in `out` at two paths (rare in stock SA) makes "overwrite in place"
  ambiguous; fall back to the loader-declared path.

## Phasing

1. **Detect + scan. ✅** `scanModloaderMod` (`bake-mod.ts`): content-detect a loader mod (`loaderFound`), walk +
   bucket the subtree into `assets`/`texts`/`dataMerges`/`refs` (BOM-aware read). Unit-tested incl. the real UTF-16
   fixture.
2. **Patch `gta.dat` + place text. ✅** `bakeMod`: `mergeGtaDat` (appended paths `canonicalDatPath`-ised to the
   stock `DATA\MAPS\…` style — backslashes + uppercase dir, filename as-is); resolve each text to overwrite-in-place
   (stock index of `out/data`) vs the loader-declared path; additive `object.dat`/`procobj.dat` via `mergeDataFile`.
3. **Inject `gta3.img`. ✅** `injectImgEntries` (`img-merge.ts`, extracted) fed the scattered asset map.
4. **e2e. ✅** Unit e2e in `bake-mod.test.ts` + an `install`-level mixed-routing case in `install.e2e.test.ts`
   (a loader mod baked + a plain mod overlaid in one run). **Plus a real `--in ./mods-src/mods` run** (9 mods,
   3 baked): each routed by kind, gta.dat patched + canonicalised to `DATA\MAPS\…`, new IDEs/IPLs on disk, stock
   IDEs overwritten, assets injected into gta3.img, CLEO/prose skipped. (Verified earlier on the larger SA
   Brightened Project bundle too — 1383 assets, ~1.26 GB gta3.img, confirming the size risk.)
5. **Docs. ✅** `002-as-built` (two apply modes + `bakeMod` + canonicalisation) + `readme` ("Baking Modloader mods").
