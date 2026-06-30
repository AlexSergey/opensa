# @opensa/mod-installer

Layer GTA-SA **mod folders** onto a base game into a single drop-in `--out`. Copy the game, then apply each mod on
top in alphabetical order — plain files overwrite, `gta3img/` loose entries merge into `gta3.img`.

```sh
tsx tools/mod-installer/src/cli.ts --game ./game-src/non-modified --in ./mods --out ./build
```

- `--game` — base game tree (`gta.dat` + `data/` + `models/gta3.img` …)
- `--in` — folder of mods; each immediate subfolder is a mod, mirroring the game tree:
  ```
  mods/
    a-trees/   { data/  models/  gta3img/ }   # gta3img/ = loose IMG entries
    b-roads/   { data/ }
  ```
- `--out` — output install dir (**wiped + rebuilt** each run)

## How it applies

1. `--out` is wiped, then the `--game` tree is copied in (the base).
2. Mod subfolders of `--in` are sorted **plain alphabetical** (`mod1`, `mod10`, `mod2` — not numeric-aware) and
   applied in order; a later mod wins on a conflict.
3. Per mod, one of two modes:
   - **Modloader mod** (its subtree carries a `loader.txt`-style file with `IDE`/`IPL`/`COLFILE` directives) — it is
     **baked** (see below).
   - **Plain mod** (no loader) — **overlay**: copy every top-level entry except `gta3img/` over `--out` (overwrites
     matching files, keeps the rest), then merge the mod's `gta3img/` loose files into `--out/models/gta3.img` (add
     or replace by name). A PNG folder beside a loose `<name>.txd` merges into that TXD (see below).

Each mod applies onto the **accumulated** `--out`, so several mods that touch different files (or different
textures / different `gta3.img` entries) all coexist; only when two mods change the **same** item does the later
one win. `gta3img/` is a generic "loose IMG entries" convention — a binary `gta3.img` can't be patched file-by-file,
so a mod expresses "add/replace these entries" as a folder; any source (the LOD tools, hand-built mods, …) can ship
one.

A guard refuses to wipe a dangerous `--out` (the filesystem root, or a path that is/contains `--game` / `--in`).

## Baking Modloader mods

A **Modloader-style** mod (a `loader.txt`/`Loader.txt`/`to gta.dat.txt` — any `.txt` carrying `IDE`/`IPL`/`COLFILE`
directives — plus files scattered anywhere in its tree) is **baked** into a flat, stock-loadable `--out` — the
on-disk equivalent of what `@opensa/modloader` does at runtime (whose pure merge logic it reuses). Per such mod:

- the loader's `IDE`/`IPL` lines are appended to `--out/data/gta.dat` (deduped, canonicalised to the stock
  `DATA\MAPS\…` style — backslashes + uppercase directory, filename as-authored);
- each `.ide`/text `.ipl` is written to disk — **overwriting the stock file** with that bare name if one exists
  (e.g. a modified `LAn.ide`), else the **loader-declared path** (a new `reLIT.ide`);
- `object.dat`/`procobj.dat` are **additively merged** onto the stock (other `.dat` overwrite);
- every `.dff`/`.txd`/`.col`/`.ifp` (and `_streamN.ipl`) is **injected into `--out/models/gta3.img` by bare name**
  (`COLFILE` is dropped — SA auto-discovers the embedded `.col`);
- UTF-16 loaders are read BOM-aware; CLEO `.cs` and prose `.txt` are ignored.

Folder names are irrelevant (files match by bare name). Note: injecting a large model bundle bloats `gta3.img` —
baking trades disk size for not needing a runtime loader. See
[`docs/plans/004-bake-modloader-mods.md`](./docs/plans/004-bake-modloader-mods.md).

## Texture folders → loose `.txd`

A mod can patch a **loose** `.txd` (a `.txd` file on disk, e.g. `models/particle.txd`, `models/generic/vehicle.txd`
— **not** textures inside `gta3.img`) by shipping a **folder of PNGs** in its place. If a mod directory's sibling
`<dir>.txd` already exists in `--out`, the folder is **not copied** — instead each `<name>.png` inside becomes a
texture named `<name>`, **replacing** the same-named texture or **adding** a new one (every other texture is left
untouched). Works at any depth.

```
mod/models/generic/vehicle/   → merges into  out/models/generic/vehicle.txd
  stock.png    (replaces the existing `stock` texture)
  decal.png    (adds a new `decal` texture)
```

Encoding follows the SA texture conventions: **DXT5** when a PNG has real alpha, else **DXT1**, with a full mip
chain — so alpha, mipmaps and compression are all handled. PNGs must be 8-bit RGB/RGBA. (The `.txd` must already
exist; mod-installer patches it, it doesn't create new dictionaries.)
