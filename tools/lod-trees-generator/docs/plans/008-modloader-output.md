# 008 — `--modloader` output (rename `--loose`)

**Status: ✅ Implemented (P1–P3b); in-game verify (P4) pending.** Replace `--loose` with **`--modloader`**: emit
**Modloader-native mods** instead of a repacked `gta3.img` (+ patched `data/gta.dat`) — **two** mods under `<out>`:
`lod/` (the LOD attachment) + `hd/` (the swapped HD models). Loose model files Modloader injects into `gta3.img` by
name; modified stock IPLs override their stock copies by name; one-line `loader.txt`s register the new IDEs;
**neither rewrites a stock IDE** (the HD mod parents TXDs via `txdp`). Reference: MixMods **"LOD Vegetation" (`./4`)**
for the LOD mod + **"BSOR Vegetation" (`./5`)** for the `txdp` HD mod.

> **Decided (revised — see "Reference reality check"):** `--modloader` uses the **same mode-A far-LOD
> attachment** as `--out`, just packaged for Modloader. The earlier "mode B (standalone `lod = -1`)" decision was
> based on a false premise (that Modloader can't patch stock binary streams). The reference proves it can — it
> ships modified binary streams under a `gta3.img/` folder — so mode A is fully Modloader-compatible **and** avoids
> the near-field double-draw. Mode B is dropped.

## Reference reality check (`./4`, MixMods "LOD Vegetation")

Verified against the real mod:

- **Own IDE + COL** (`LODvegetation.ide`, new ids 12004+, `LODvegetation.col`) — exactly like our `lodtrees.ide`.
  It rewrites **zero stock IDEs**.
- **Mode A (LOD-link), in Modloader form.** Byte-checked: across the 9 `countn2` binary streams the instance count
  is unchanged (2020 = 2020) but **211 HD `lod` fields are repointed**, and the companion text IPL grew by 211 LOD
  rows (each `lod = -1`, i.e. a LOD target). It ships the modified **text IPLs** under `map/data/maps/...` and the
  modified **binary streams** under `map/gta3.img/...`, all as name/path overrides.
- `loader.txt`: **only `COLFILE` + `IDE`** — no `IPL` line. The stock IPLs are overridden by name, not added.
- No HD swap → no stock-IDE/TXD edit.

This is exactly what our `--out` pipeline (`editAreas`) already produces (`result.texts` + `result.streams`); only
the **packaging** differs.

## Target layout for `--modloader` — TWO mods (`lod/` + `hd/`)

```
<out>/
  lod/                               # the LOD attachment (mode A — like the ./4 reference)
    loader.txt                       #   one line: `IDE data/maps/lodtrees.ide` (no IPL — stock IPLs override by name; no COLFILE — col embedded)
    data/maps/lodtrees.ide           #   impostor object defs (our own new IDE — NO stock IDE touched)
    data/maps/<area>.ipl …           #   the modified stock TEXT IPLs (only areas actually touched) — loose overrides
    gta3img/                         #   → gta3.img by name: modified binary streams + impostor .dff + lodtrees.txd/.col
  hd/                                # the swapped HD models (only with `--in`)
    loader.txt                       #   one line: `IDE data/maps/lodtrees_hd.ide`
    data/maps/lodtrees_hd.ide        #   a `txdp` section: each swapped model's stock TXD → the custom parent TXD
    gta3img/                         #   → gta3.img by name: swapped (prelit) HD .dff + the custom TXD
```

Neither mod rewrites a stock IDE. The col is embedded in `gta3.img` (no `COLFILE`).

## Why no double-draw (vs the dropped mode B)

SA has no min-draw-distance, so a _standalone_ impostor (`lod = -1`) would draw from 0 and double over its HD tree
in the 0–300 m band. Mode A links the impostor as the HD's far-LOD, so the engine only draws it once the HD has
culled — no doubling. The reference uses mode A precisely for this; we now do too.

## HD as a separate `hd/` mod via `txdp` (revised — was "HD swap dropped")

The HD models carry our prelight + processing, so we **don't** drop them. But the original `--in` swap rewrote the
swapped models' **stock IDEs** (retxd repointing their `txd` to a custom TXD), which Modloader would fully replace —
fragile. Fix (the [`./5`] "BSOR Vegetation" approach): ship the swapped HD as a **separate `hd/` mod** that, instead
of editing the stock IDE, adds a **`txdp` (TXD-parent) section** — `<stock txd>, <custom txd>` — so the stock TXD
inherits any texture it lacks from our custom parent TXD. The stock IDEs stay untouched, and OpenSA's engine
resolves `txdp` too (`asset-cache`), so the same mod works in both. The `txdp` mapping is built by
`txdpSwappedModels` (`@opensa/map-placement/retxd`), reusing the model→custom-TXD resolution that retxd uses.
`--out` keeps the inline IDE-repoint swap (a single repacked drop-in can patch IDEs freely).

## What changed vs the old `--loose` / mode B

| Old (`--loose` / mode B)                                    | `--modloader` (two mods)                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| standalone `lodtrees.ipl` (`lod = -1`) → double-draw        | `lod/`: modified stock IPLs (text + binary), HD `lod` repointed → no double-draw                |
| `loader.txt` with `IDE` + `IPL`                             | `lod/loader.txt` with **`IDE` only** (stock IPLs override by name)                              |
| HD swap + retxd → **stock IDEs rewritten**                  | `hd/`: swapped HD via a **`txdp` IDE** → **no stock IDE touched**                               |
| all `.dff`/`.txd`/`.col` (+ swapped HD) loose in `gta3img/` | `lod/gta3img/` (streams + impostor `.dff` + atlas/col) + `hd/gta3img/` (HD `.dff` + custom TXD) |

## Scope: real game now, OpenSA next stage

`--modloader` targets the **real game's `modloader.asi`** (the `./4` format). OpenSA's own `packages/modloader`
currently only overrides `.dff`/`.txd` — not `loader.txt`/IPL/IDE — so these mods' defs/placements wouldn't load in
OpenSA yet. **Next stage** (separate plan): extend `packages/modloader` to read `loader.txt` + virtualize IPL/IDE
so the same `--modloader` output also works in OpenSA.

## Phasing

- **P1 — flag. ✅** `--loose` → `--modloader` (`cli.ts`, `index.ts`, `place-map.ts`, `strip-map.ts`, readme).
- **P2 — mode-A packaging. ✅** `placeModloader` (`place-map.ts`) now packages the shared `editAreas` output:
  modified text IPLs → loose overrides under `data/maps/`, modified binary streams + impostor DFFs +
  `lodtrees.txd`/`.col` → `gta3img/`, `lodtrees.ide` registered via a one-line `loader.txt`. No HD swap, no stock
  IDE/`gta.dat`. The mode-B `placeModloader`/`collectPlacements`/standalone-IPL code was removed. `editAreas` now
  skips emitting no-op (untouched) text IPLs, so the mod ships only the areas it changed.
- **P3 — `lod/` mod verify (offline). ✅** On `non-modified` with the vegetation pack: 9814 instances attached
  (9463 appended, 351 repointed), 184 impostors; `lod/` = 25 modified text IPLs (LA/SF/country/vegas/levelmap), 155
  modified binary streams + 184 DFFs + `lodtrees.txd`/`.col` in `gta3img/`, `loader.txt` = `IDE
data/maps/lodtrees.ide`. Matches the `./4` reference layout.
- **P3b — `hd/` mod via `txdp` (revised — HD no longer dropped). ✅** `emitHdMod` (`place-map.ts`) +
  `txdpSwappedModels` (`retxd.ts`): the swapped (prelit) HD DFFs + custom TXD → `hd/gta3img/`, a `txdp` IDE
  (`lodtrees_hd.ide`) parenting each stock TXD → the custom TXD, a one-line `loader.txt`. Verified: `hd/` ships 138
  HD DFFs + `vegetation.txd` + a 29-pair `txdp` IDE. **Entire output has exactly two IDEs (both ours), zero stock
  IDEs.** Lint clean, 45 (place) / 93 (incl. map-placement) tests pass.
- **P4 — in-game verify** (real Modloader install, pending): impostors show at distance, no doubling, HD textures
  resolve via `txdp`, archives re-parse, no missing-collision fault.

## Relationship

- Mirrors **lod-procobj-generator 004** for the shared `--modloader` packaging (`gta3img/` + `loader.txt`). Note
  lod-procobj is structurally different — its LODs are **new** standalone placements (procobj scatter has no static
  IPL to attach to; it also strips `procobj.dat` so there's no runtime double-draw), so it has no mode-A/B split.
- `004-map-place.md` + [`ipl-lod-index-coupling`] — the text↔binary LOD-index coupling that mode A relies on (a
  modified binary stream always implies its companion text IPL was modified, so no orphan indices ship).
