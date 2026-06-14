# 047 — Rewrite the timecyc-builder on the canonical parser

The `timecyc-builder/` dev tool merges values from one or more timecyc files into a base timecyc
(selectively by **weather/zone**, **time/hour**, and **property**). Its current merge logic is wrong. Rewrite
it on the project's canonical timecyc parser (`src/renderware/parsers/text/timecyc.parser.ts`) instead of the
bundled bespoke parser, and fix the merge semantics. **Status: ✅ DONE (2026-06-14).**

## Intent (the desired behaviour)

A merge item is a selective overlay onto the base:

```ts
{ path, props?: string[], times?: string[], zones?: string[] }
```

- `zones` — weather names to affect; **omitted ⇒ all weathers**.
- `times` — hours (`'0h'..'23h'`) to affect; **omitted ⇒ all hours**.
- `props` — property labels (`'Sky top'`, `'Sky bot'`, …) to affect; **omitted ⇒ all properties**.
- For every (weather ∈ zones) × (hour ∈ times) × (property ∈ props), the base value is replaced by the merge
  source's value at the same weather+hour+property. Items apply in array order (later wins).

Examples (from `index.ts`):
- `{ props:['Sky top','Sky bot'], times:['20h'…'5h'] }` → only Sky top/bot, only those hours, **all** weathers.
- `{ zones:['CLOUDY_VEGAS'] }` → the whole `CLOUDY_VEGAS` weather (all hours, all props) replaced by the source.

## Current bug (why it's wrong)

`core/timecyc-manager.ts` runs **three independent `find`s** (by zones, then times, then props) over the nested
`Record<weather, Record<hour, Record<prop, string[]>>>`:

1. The **times** pass copies the **entire hour (all 52 props)** from the first item whose `times` match —
   ignoring that item's `props` filter. So example 1 overwrites *every* field for 20h–5h, not just the sky.
2. `find` returns the **first** matching item, so the three dimensions can come from **different** items, and
   combined filters (props *and* times on one item) don't intersect — they stack incorrectly.
3. `skipProps` is a patch over this tangle.

The fix is one combined-filter pass per item (intersection of the three dimensions), not three global finds.

## Canonical parser — what we already have (verified)

`parseTimecyc(text)` → `number[][]`: for the 24h files here, **552 rows = 23 weathers × 24 hours**, each row
**52 numbers** in `FIELDS` order. `WEATHER_NAMES` is exactly the 23 weather names (incl. `UNDERWATER`,
`EXTRACOLOURS_1/2`); `HOURS = 24`; `FIELDS` gives each field's `kind` (rgb/rgba/float/int → width 3/4/1/1).
A label→`[offset,width]` map builds trivially from `FIELDS` (e.g. `skyTop` = `[9,3]`, `skyBot` = `[12,3]`).
Row index for (weather `w`, hour `h`) = `w * 24 + h`.

This replaces the builder's duplicated `parsers/timecyc/` + `timecyc.constants.ts` (its `weather` ==
`WEATHER_NAMES`, `properties` == `FIELDS` + labels, `time` == derivable).

## Plan

### Parser additions (`src/renderware/parsers/text/timecyc.parser.ts`) — read/write pair
1. **`FIELD_LABELS: readonly string[]`** — the SA header display labels aligned 1:1 with `FIELDS`
   (`'Amb','Amb_Obj','Dir','Sky top','Sky bot',…,'DirMult'`). Single source of truth for the labels used by
   the file header and the builder's `props` selection. (Add as a sibling const, or a `label` on each `Field`.)
2. **`stringifyTimecyc(rows, opts?)`** — emit SA 24h timecyc text from `number[][]`: per-weather/per-hour
   `//` comment separators + the `FIELD_LABELS` header + one space-joined data line per row (ints as ints,
   floats ≤2dp — matching what `parseTimecyc` reads back). The game's `parseTimecyc` already ignores comments,
   so the output round-trips.
   - **Key property (tested):** `parseTimecyc(stringifyTimecyc(rows)) ≈ rows` — idempotent, since `parseTimecyc`
     already rounds floats/truncates ints, so re-parsing parsed rows is stable.
   - *(Alternative if we want to keep the game parser read-only: put `stringifyTimecyc` + `FIELD_LABELS` in a
     small `timecyc-builder/` module that imports `FIELDS`. Decision: keep it in the parser — reusable, and a
     parse/stringify pair is the natural home.)*

### Builder rewrite (`timecyc-builder/`)
3. **Delete** `parsers/timecyc/index.ts` and `parsers/timecyc/timecyc.constants.ts` (bespoke parser + dup
   constants). Source everything from the canonical parser.
4. **`interfaces/timecyc.interface.ts`** — keep `TimecycItem` (`{ path, props?, times?, zones? }`); drop
   `skipProps` and the nested `TimecycParsed` type (we work on flat `number[][]`). Add a parsed-rows field
   for loaded items.
5. **Pure merge** — `core/merge.ts`: `mergeTimecyc(base: number[][], items: ResolvedItem[]): number[][]`
   (clone base; for each item resolve zones→weather indices, times→hour indices, props→field ranges, each
   defaulting to "all"; copy the selected field ranges from the item's rows into the result). Pure, no I/O →
   directly unit-testable. Resolution helpers: `'Nh'→N`, `weatherName→index` (via `WEATHER_NAMES`),
   `label→[offset,width]` (via `FIELDS`+`FIELD_LABELS`); unknown label/zone/hour → warn + skip (no crash).
6. **`core/timecyc-manager.ts`** — thin orchestrator: `setBase`/`setTimecycToMerge` read files with
   `parseTimecyc` then **normalise to 24h via the parser's `ensure24h`** (a vanilla 8-keyframe `timecyc.dat`
   is auto-converted with `convertTo24h`; an already-24h file passes through). So base and each merge source
   may be in either format; the merged output is always 24h. `merge()` calls `mergeTimecyc`, writes via
   `stringifyTimecyc`. (`ensure24h` is a new parser export, unit-tested.)
7. **`index.ts`** — unchanged public shape; writes `merged/timecyc_24h.dat`.

### Tests (mandatory — see memory tests-mandatory)
8. Parser: `timecyc.parser.test.ts` — extend with `stringifyTimecyc` round-trip (`parse∘stringify` identity
   on the real `tests/data/timecyc_24h.dat`) + header/`FIELD_LABELS` length == `FIELDS` length.
9. Builder: `core/merge.test.ts` — negative (unknown prop/zone/hour skipped; empty items = base unchanged) then
   positive: props-only overlay touches **only** those columns; times-only restricts to those hours;
   zones-only replaces the whole weather; combined props+times intersect; multiple items apply in order
   (later wins); a cell *outside* every filter is byte-identical to base (the exact regression from the bug).
10. **Vitest wiring:** add `timecyc-builder/**/*.test.ts` to `vitest.config.ts` `test.include` so the dev-tool
    tests run with `npm test`. Coverage `include` stays `src/**` (the dev tool isn't gated), but the parser
    additions in #1–2 are covered and counted.

### Verify
11. `npm test` green (incl. new builder + parser tests), `npx tsc --noEmit`, eslint clean, no Cyrillic.
12. Run `npm run timecyc`; confirm example 1 changes **only** Sky top/bot for the listed hours (diff the output
    vs base — all other columns/weathers identical), and a `zones`-only item replaces exactly that weather.

## Out of scope
- Changing the SA timecyc field set or the game's read path beyond the additive `FIELD_LABELS`/`stringifyTimecyc`.
- 8-keyframe→24h authoring (inputs are already 24h; only validate/guard).
