# 003 — vehicle-installer: custom colour palettes

**Plan only — implement after.** A vehicle's `*.settings.txt` may define **new colours** that don't exist in the
stock `carcols.dat` `col` palette. Install must append them to the palette (assigning the next free colour IDs)
and rewrite the symbolic references in the carcols line to those IDs.

## The data

`carcols.dat` opens with a `col … end` section — the shared colour palette, one `R,G,B` per line. The engine
(`parseCarcols`) indexes it **by line order**, so a colour's **ID = its 0-based position** (the `# 34` comment is
just that index). The `car`/`car4` lines reference palette entries by that numeric ID (`admiral, 34,34`).

A vehicle with custom paint ships a **palette block** in its settings + symbolic refs in the carcols line
(example `cabbie`):

```
233,199,40             # new1 yellow taxi cab        yellow
186,208,125            # new2 light green cab         green

cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0
```

`new1`/`new2` are placeholders for colours not yet in the palette. The stock palette has **127** entries (ids
0–126), so on install `new1 → 127`, `new2 → 128`; the block becomes real `col` lines and the carcols line resolves:

```
233,199,40             # 127 yellow taxi cab         yellow      ← appended to `col`
186,208,125            # 128 light green cab          green

cabbie, 6,0,6,0, 128,0,128,0, 127,0,127,0                        ← merged into car4 (4 values/combo)
```

**Many vehicles accumulate**: IDs are assigned relative to the **current** palette size, and the tool patches
`carcols.dat` in place per vehicle, so the next vehicle's `new1` continues after the previous vehicle's additions
(129, 130, …).

## Settings — a 5th block type

`*.settings.txt` blocks are blank-line-separated. The four existing kinds (ide/handling/carcols/carmods) each take
the block's first line; the **palette block** is **multi-line** — every line is `R,G,B  # newN <desc>`. Detection:
the line has a `#` comment whose first token matches `new\d+`, and 3 comma-separated integers precede the `#`.
`parseVehicleSettings` collects all such lines into `settings.palette: { name, line }[]` (name = `newN`, line =
the verbatim `R,G,B # …` to append). Any block may be absent.

## Algorithm (in the carcols edit)

When `apply-vehicle` edits `out/data/carcols.dat` for a vehicle, **before** the car/car4 merge:

1. **Assign IDs** — `next = parseCarcols(text).palette.length`; for palette entry `i` (in block order),
   `idByName[name] = next + i`.
2. **Append `col` lines** — for each entry, replace its `newN` token with the assigned id (so the `# 127` comment
   is correct) and insert the line before the `col` section's `end`.
3. **Resolve refs** — in the carcols line, replace each `newN` token (whole-word) with its id.
4. **Merge** the resolved carcols line into `car`/`car4` as today (colour count from the line, move + alpha-sort).

No palette block ⇒ steps 1–3 are no-ops (`idByName` empty, line unchanged).

## Modules

```
tools/vehicle-installer/src/
  palette.ts    addPaletteColors(carcolsText, palette) → { text, idByName }  ·  resolveColorRefs(line, idByName)
  settings.ts   + detect the palette block → settings.palette
  apply-vehicle.ts  in the carcols edit: addPaletteColors → resolveColorRefs → mergeCarcols (unchanged)
```

`merge.ts` (`mergeCarcols`) stays as-is — it receives the already-resolved (numeric) carcols line. Reuse
`parseCarcols` (`@opensa/renderware`) to count the current palette size.

## Decisions / assumptions

- **ID = palette length** (positional), matching the engine's `parseCarcols` indexing. New `col` lines are appended
  before the section `end` (trailing blank lines there are harmless — not counted).
- **Ref tokens** are matched whole-word (`\bnewN\b`) so `new1` never matches inside `new10`; both the carcols line
  and the appended `col` comment get the substitution.
- **Name source** = the first token after `#` on each palette line.
- A palette block with **no** matching carcols line still appends its colours (harmless); the realistic case always
  pairs them.

## Task plan (phases)

1. **settings** ✅ — detect + collect the palette block (`settings.palette`); the carcols classify also accepts
   `newN` cells (so a ref'd line isn't mistaken for carmods). Unit: palette block parses to `{ name, line }[]` and
   the ref'd carcols line stays `carcolsLine`.
2. **palette** ✅ — `palette.ts`: `addPaletteColors` (append to `col`, return `idByName`) + `resolveColorRefs`.
   Unit: ids continue from the current palette length; `col` lines appended with the numeric comment; refs
   resolved whole-word; accumulation across two calls.
3. **apply-vehicle** ✅ — palette wired into the carcols edit (append colours → resolve refs → `mergeCarcols`);
   no-op when absent.
4. **e2e** ✅ — `install.e2e`: a `cabbie`-style vehicle (palette + 4-colour carcols with refs) over the real
   `carcols.dat` → palette grew 127→129, the car4 line resolved to ids 127/128, no `newN` left, parses via
   `parseCarcols`.
5. **docs** ✅ — `readme.md` (custom-colours section + settings-table row) + plans index; multi-vehicle
   accumulation noted.

`tsc`/`eslint`/tests green (vehicle-installer 31).
