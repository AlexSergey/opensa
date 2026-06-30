# 002 — mod-installer: how it works (as-built)

**Post-factum reference for the shipped tool** (the forward-looking design is [001](./001-architecture.md); this
doc describes the code as it actually runs). `@opensa/mod-installer` (`tools/mod-installer`, `type:tool`) layers
GTA-SA **mod folders** onto a base game into a single drop-in `--out`. Each mod applies onto the **accumulated**
`--out`, so mods touching different files/textures/`gta3.img` entries coexist; only on the **same** item does the
later (alphabetically) mod win. `gta3img/` is a generic "loose IMG entries" convention — a binary `gta3.img` can't
be patched file-by-file, so a mod ships the entries as a folder; mod-installer **applies** such a drop.

> Later addition: a mod can also patch a loose `.txd` by shipping a **folder of PNGs** in its place — see
> [003 — merge PNG folders into loose `.txd`](./003-loose-txd-png-merge.md).

```sh
tsx tools/mod-installer/src/cli.ts --game ./game-src/non-modified --in ./mods --out ./build
```

## Inputs

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …). Must be a directory (CLI checks).
- `--in` — folder of mods; each **immediate subfolder** is one mod, mirroring the game tree, with an optional
  `gta3img/` of loose IMG entries:
  ```
  mods/
    a-trees/   { data/  models/  gta3img/ }   # gta3img/ = loose entries to merge into gta3.img
    b-roads/   { data/ }
  ```
  Must be a directory (CLI checks).
- `--out` — output install dir, **wiped + rebuilt every run**.

All three are resolved relative to the cwd (`cli.ts` `fromCwd`); absolute paths pass through.

## Control flow

`cli.ts main()` → `install({ gamePath, inPath, outPath })`:

1. **Resolve + guard** — `install` re-`resolve`s the three paths and calls `guardOut` (see below) before touching
   the disk.
2. **Reset base** — `rmSync(out, {recursive, force})` then `cpSync(game → out, {recursive, force})`. `--out` is now
   the stock game; no stale files survive from a previous run.
3. **Order mods** — `readdirSync(in, {withFileTypes})` → keep directories → `sortMods` (plain case-insensitive
   `localeCompare(_, _, 'en')`, **not** numeric-aware: `mod1`, `mod10`, `mod2`). Later mods win on conflict.
4. **Apply each** — `bakeMod(in/<mod>, out)` first: a mod whose subtree carries a **loader file** is **baked**
   (see below); otherwise (`baked:false`) it falls back to `applyMod(in/<mod>, out)` (the plain overlay). Summed.
5. **Report** — `console.log` `N mod(s) (B baked) → <out> (M entries merged into gta3.img / loose .txd)`.

### `guardOut(out, game, in)` — refuses a dangerous wipe

Throws if any of:

- `out` is the filesystem root (`parse(out).root`).
- `out` equals `--game` or `--in`.
- `out` is a **parent of** `--game` or `--in` (`game.startsWith(out + sep)` …) — wiping it would destroy an input.

### `applyMod(modPath, outPath)` → `{ copied, merged }`

Per mod, in order:

1. **Overlay entries** — for **every** top-level entry except `gta3img/` (case-insensitive), `applyEntry(mod/entry →
out/entry)`. `applyEntry` is a **recursive walk** (not a shallow `cpSync`):
   - a **file** → `cpSync` (overwrite);
   - a **directory** whose sibling `<dir>.txd` already exists as a loose file in `--out` → a **texture folder**: its
     PNGs merge into that `.txd` (add/replace by name) instead of being copied — see
     [003](./003-loose-txd-png-merge.md) (e.g. `models/generic/vehicle/` → `models/generic/vehicle.txd`);
   - otherwise a plain folder → recurse, copying **files first then subfolders** so a `.txd` the mod also ships is in
     place before a sibling PNG folder merges into it.
2. **Merge IMG** — if `mod/gta3img/` exists and is a directory, `mergeGta3Img(mod/gta3img, out/models/gta3.img)`.
   Done **after** the file copy, so the entries land on whichever `gta3.img` this mod just shipped (or the
   inherited one). `gta3img/` is the only top-level special-cased name.

### `mergeGta3Img(gta3imgDir, imgPath)` → number merged

Over `@opensa/tool-kit/archive/img`: read the loose files in `gta3imgDir` into a `name → bytes` map, then
`injectImgEntries(entries, imgPath)` — `openImg(bytes)` the existing `imgPath` (or `createImg()` to seed a fresh
one), `img.set(name, bytes)` each (add new / replace by name), and `writeFile(imgPath, img.build())` (mkdir-p the
parent). The baker reuses `injectImgEntries` with the scattered-asset map.

### `bakeMod(modPath, outPath)` → `{ baked, assets, texts }` — Modloader-style mods (see [004](./004-bake-modloader-mods.md))

`scanModloaderMod` walks the subtree (any depth) and buckets every file by **bare name** — `assets`
(dff/txd/col/ifp/`_stream`.ipl), `texts` (ide/text-ipl/whole-file dat), `dataMerges` (object/procobj.dat),
`refs` (IDE/IPL/COLFILE from any **loader file** — a `.txt` parsing to ≥ 1 directive, read **BOM-aware**). If no
loader is found → `{ baked:false }` (caller uses `applyMod`). Otherwise it **materialises** onto `out`, reusing
`@opensa/modloader`'s pure logic (`parseLoader`/`mergeGtaDat`/`mergeDataFile`/`ADDITIVE_DAT` — `type:tool → type:engine`):

1. `mergeGtaDat` appends the loader's `IDE`/`IPL` to `out/data/gta.dat` (COLFILE dropped — col goes into gta3.img),
   canonicalising each appended path to the stock convention — backslashes + UPPERCASE directory (`DATA\MAPS\…`),
   filename as-authored — so the baked `gta.dat` reads consistently (the engine is slash/case-insensitive anyway).
2. each text file → overwrite the **stock file with that bare name** (indexed from `out/data`), else the
   **loader-declared path** (`reLIT.ide` → `DATA\MAPS\reLIT.IDE`).
3. `object.dat`/`procobj.dat` → `mergeDataFile` (additive); other `.dat` → overwrite.
4. `injectImgEntries` sets every `assets` entry into `out/models/gta3.img` by name.

CLEO `.cs`, vehicle `*.settings.txt`, and prose `.txt` are ignored.

## Modules

```
tools/mod-installer/src/
  cli.ts         arg parsing (--game/--in/--out), directory validation → install()
  install.ts     install() orchestrator · guardOut() · sortMods(); per mod: bakeMod else applyMod
  apply-mod.ts   applyMod()/applyEntry(): recursive overlay (files-first) + txd-folder detection + gta3img merge
  bake-mod.ts    scanModloaderMod()/bakeMod(): bake a loader.txt-style mod (gta.dat + disk + gta3.img) — see 004
  img-merge.ts   mergeGta3Img() / injectImgEntries(): set entries into models/gta3.img (seed if absent)
  txd-folder.ts  mergeTxdFolder(): a PNG folder → add/replace textures in a loose .txd (see 003)
  png-texture.ts pngToTextureNative(): decode → DXT5(alpha)/DXT1 → mip chain → RW TextureNative
  png-decode.ts  decodePng(): hand-rolled PNG decode (fflate inflate + un-filter; 8-bit RGB/RGBA)
  test-utils.ts  buildTxd / encodePng / solidRgba — test-only fixtures
```

Dependencies: `@opensa/tool-kit/archive/img` + `@opensa/rw-codec` + `@opensa/modloader` (pure merge helpers) +
`@opensa/renderware/archive` (`normalizeDatPath`) + `fflate` + Node `fs`/`path`.

## Notes / edge cases

- **IMG format** — `tool-kit`'s IMG writer emits VER2 and pads each entry to a whole **2048-byte sector**, so a
  merged entry's bytes are sector-aligned in the output (the e2e test slices off the leading bytes when asserting).
- **`gta3img/` target is fixed** at `models/gta3.img`; a `gta_int.img` drop convention is out of scope.
- **No dry-run / numeric sort** today — candidates if needed.

## Test coverage anchors

- `install.test.ts` — `guardOut` negatives (root / equals an input / contains an input) + positive; `sortMods`
  (plain-not-numeric, case-insensitive, no input mutation).
- `img-merge.test.ts` — empty-folder no-op; seed a fresh archive; replace-by-name keeping the others.
- `txd-folder.test.ts` — no-PNG no-op; not-a-TXD throws; replace + add, leaving the rest untouched.
- `png-decode.test.ts` — bad signature / unsupported colour type throw; RGB + RGBA round-trips; all 5 scanline filters.
- `png-texture.test.ts` — opaque → DXT1, alpha → DXT5 (parsed back: name + size + mip count).
- `bake-mod.test.ts` — `scanModloaderMod` buckets + `loaderFound` (incl. the real UTF-16 fixture); `bakeMod` e2e
  (gta.dat patched, new-at-declared-path + stock overwritten in place, additive procobj, dff/col into gta3.img,
  prose/CLEO skipped); `baked:false` for a non-loader mod.
- `install.e2e.test.ts` — full tmpdir runs: base copy + alphabetical overlay + `gta3img/` merged into `gta3.img`
  (accounting for the 2048-byte sector padding); a nested PNG folder merged into a loose `.txd`; files-first ordering.

29 tests, green. Also verified by a real `--in ./mods-src/mods` run (mix of plain + Modloader mods): each mod
routed by kind (loader → baked, else overlaid), gta.dat lines canonicalised to `DATA\MAPS\…`, assets into gta3.img.
