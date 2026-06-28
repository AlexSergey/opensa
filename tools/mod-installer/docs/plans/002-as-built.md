# 002 — mod-installer: how it works (as-built)

**Post-factum reference for the shipped tool** (the forward-looking design is [001](./001-architecture.md); this
doc describes the code as it actually runs). `@opensa/mod-installer` (`tools/mod-installer`, `type:tool`) layers
GTA-SA **mod folders** onto a base game into a single drop-in `--out`. It is the inverse of the LOD tools'
`--loose` output: those emit a `gta3img/` drop, mod-installer **applies** such drops.

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
4. **Apply each** — `applyMod(in/<mod>, out)` in order, summing merged IMG entries.
5. **Report** — `console.log` `N mod(s) → <out> (M gta3.img entries merged)`.

### `guardOut(out, game, in)` — refuses a dangerous wipe

Throws if any of:

- `out` is the filesystem root (`parse(out).root`).
- `out` equals `--game` or `--in`.
- `out` is a **parent of** `--game` or `--in` (`game.startsWith(out + sep)` …) — wiping it would destroy an input.

### `applyMod(modPath, outPath)` → `{ copied, merged }`

Per mod, in order:

1. **Overlay files** — for **every** top-level entry except `gta3img/` (case-insensitive), `cpSync(mod/entry →
out/entry, {recursive, force})`. So `data/`, `models/`, `anim/`, `text/`, … overwrite matching files and keep
   the rest. `gta3img/` is the **only** special-cased name.
2. **Merge IMG** — if `mod/gta3img/` exists and is a directory, `mergeGta3Img(mod/gta3img, out/models/gta3.img)`.
   Done **after** the file copy, so the entries land on whichever `gta3.img` this mod just shipped (or the
   inherited one).

### `mergeGta3Img(gta3imgDir, imgPath)` → number merged

Over `@opensa/tool-kit/archive/img`:

- List the loose files in `gta3imgDir`; if none, return 0 (no-op).
- `openImg(bytes)` the existing `imgPath`, or `createImg()` if it doesn't exist yet (the loose files **seed** a
  fresh archive).
- `img.set(name, bytes)` each loose file (add new / replace existing **by name**), then `writeFile(imgPath,
img.build())` (mkdir-p the parent).

## Modules

```
tools/mod-installer/src/
  cli.ts         arg parsing (--game/--in/--out), directory validation → install()
  install.ts     install() orchestrator · guardOut() · sortMods()
  apply-mod.ts   applyMod(): copy non-gta3img entries (overlay) + merge gta3img into out's gta3.img
  img-merge.ts   mergeGta3Img(): set loose gta3img/ files into models/gta3.img (seed if absent)
```

Dependencies: `@opensa/tool-kit/archive/img` (`openImg`/`createImg` → `set`/`build`) + Node `fs`/`path` only. No
engine, no shared map packages.

## Notes / edge cases

- **IMG format** — `tool-kit`'s IMG writer emits VER2 and pads each entry to a whole **2048-byte sector**, so a
  merged entry's bytes are sector-aligned in the output (the e2e test slices off the leading bytes when asserting).
- **`gta3img/` target is fixed** at `models/gta3.img`; a `gta_int.img` drop convention is out of scope.
- **No dry-run / numeric sort** today — candidates if needed.

## Test coverage anchors

- `install.test.ts` — `guardOut` negatives (root / equals an input / contains an input) + positive; `sortMods`
  (plain-not-numeric, case-insensitive, no input mutation).
- `img-merge.test.ts` — empty-folder no-op; seed a fresh archive; replace-by-name keeping the others.
- `install.e2e.test.ts` — full tmpdir run: base copy + alphabetical overlay + `gta3img/` merged into `gta3.img`
  (accounting for the 2048-byte sector padding).

11 tests, green.
