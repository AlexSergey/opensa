# 001 — mod-installer: architecture & task plan

**Plan only — no code yet.** A drop-in mod layering tool: copy a base game to `--out`, then apply each mod folder
under `--in` on top, in alphabetical order — plain files overwrite, `gta3img/` entries merge into `gta3.img`.

> Shipped. For the **as-built** behaviour (exact functions, guard rules, edge cases, test anchors) see
> [002 — how it works (as-built)](./002-as-built.md).

## Idea

```
tsx tools/mod-installer/src/cli.ts --game ./game-src/non-modified --in ./mods --out ./build
```

- `--game` — the base game tree (`gta.dat` + `data/` + `models/gta3.img` …).
- `--in` — a folder of **mods**, each an immediate subfolder. A mod mirrors the game tree, e.g.
  ```
  mods/
    mod1/
      data/            # data files (gta.dat, maps/*.ipl, *.ide, procobj.dat …)
      models/          # models (gta3.img, *.col …)
      gta3img/         # loose IMG entries to merge into models/gta3.img
    mod2/
      data/
  ```
- `--out` — the merged install (a full drop-in game tree).

## Apply algorithm

1. **Base** — copy the entire `--game` tree to `--out` (recursive, overwrite). `--out` is now the stock game.
2. **Mods** — list the immediate subfolders of `--in`, sort **alphabetically** (case-insensitive), and apply each
   in order. Each mod overlays the current `--out`, so a later mod wins on a conflict (last-write).
3. **Per mod**, in this order:
   1. **Copy files** — copy every top-level entry of the mod **except `gta3img/`** into `--out`, recursively
      overwriting (so `data/`, `models/`, and any other game-tree folder land on top of the base + earlier mods).
   2. **Merge `gta3img/`** — if the mod has a `gta3img/` folder, open the **current** `--out/models/gta3.img`
      (which may have just been replaced by this mod's `models/gta3.img`), `set` each loose file in `gta3img/` as
      an IMG entry (add or replace by name), rebuild, and write it back to `--out/models/gta3.img`.

   `gta3img/` is applied **after** the file copy so its entries land on whichever `gta3.img` this mod ships (or the
   inherited one). If `--out` has no `gta3.img` yet, the entries seed a fresh archive.

`gta3img/` is a generic "loose IMG entries" convention (a binary `gta3.img` can't be patched file-by-file, so a mod
ships the entries as a folder); mod-installer is what **applies** such a drop into `gta3.img`.

## Modules

A small, dependency-light tool (mostly fs + the IMG archive editor — no new shared packages):

```
tools/mod-installer/src/
  cli.ts         arg parsing (--game/--in/--out) → install()
  install.ts     orchestrator: copy game → out, sorted mod loop, apply each
  apply-mod.ts   one mod: copy non-gta3img entries (overwrite) + merge gta3img into out's gta3.img
  img-merge.ts   set loose gta3img/ files into models/gta3.img (reuse @opensa/tool-kit/archive/img)
```

Reuse: `@opensa/tool-kit/archive/img` (`openImg`/`editArchive` + `set`/`build`) and
`@opensa/renderware/archive/img-archive` (`openArchive`) for the IMG merge; Node `fs` (`cpSync` for the recursive
copy/overwrite, `readdirSync`/`statSync` for the mod scan).

## Task plan (phases)

1. **Scaffold** ✅ — `tools/mod-installer/` package (workspaces + symlink + vitest glob + eslint override + nx tag).
2. **Core copy/overlay** ✅ — `install.ts` (wipe + base copy + guarded `--out` + sorted mod loop) · `apply-mod.ts`
   (copy every entry except `gta3img/`, overlay).
3. **gta3img merge** ✅ — `img-merge.ts` over `@opensa/tool-kit/archive/img` (set loose entries + rebuild; seeds a
   fresh archive if absent); wired into `apply-mod`.
4. **CLI + tests** ✅ — `cli.ts`; `sortMods` unit test (plain vs numeric) + a tmpdir IMG-merge integration test
   (seed + replace-by-name). `tsc`/`eslint`/tests green.
5. **Verify** — _pending the user_: run on `./game-src/non-modified` + a couple of mod folders (each mirroring the
   game tree, with an optional `gta3img/`); confirm the merged `--out` loads in-game.

## Decisions (resolved)

1. **Which mod entries are copied** — **every** top-level entry except `gta3img/` (so `data/`, `models/`, plus any
   `anim/`, `audio/`, `text/`, … all overlay). `gta3img/` is the only special-cased name (merged into `gta3.img`).
2. **`--out` before a run** — **wiped, then re-copied fresh** from `--game` (no stale files from a previous run).
   Guarded: only remove `--out` after it resolves to a real path under the cwd / an explicit arg (never an empty
   or root path).
3. **Mod sort** — plain case-insensitive ascending (`localeCompare`, **not** numeric-aware: `mod1`, `mod10`,
   `mod2`).

## Assumptions (not blocking)

- **`gta3img/` target** is `models/gta3.img`. A `gta_int` drop convention is out of scope unless asked.
