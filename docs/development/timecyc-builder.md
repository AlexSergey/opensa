# timecyc-builder

A dev tool (`timecyc-builder/`) that builds a custom `timecyc_24h.dat` by **selectively merging** values from
one or more donor timecyc files onto a base. Built on the canonical parser
(`src/renderware/parsers/text/timecyc.parser.ts`) — see plan 047.

## Run

```bash
npm run timecyc
```

Reads the config in `timecyc-builder/index.ts`, writes `timecyc-builder/merged/timecyc_24h.dat`.

## Layout

- `base/` — the base timecyc (every value starts from here).
- `merge/` — donor files to pull values from.
- `merged/` — the output (always 24h).

Input files (base **or** any donor) may be **vanilla 8-keyframe** (`timecyc.dat`) or **already-24h**
(`timecyc_24h.dat`): vanilla is auto-converted (`ensure24h` → `convertTo24h`) on load. The output is always 24h.

## API

```ts
const manager = new TimecycManager();
await manager.setBase(resolve(__dirname, './base/timecyc_24h.dat'));
await manager.setTimecycToMerge([
  { path: resolve(__dirname, './merge/RealVision_Enhanced_24h.dat'),
    props: ['Sky top', 'Sky bot'],
    times: ['20h', '21h', '22h', '23h', '0h', '1h', '2h', '3h', '4h', '5h'] },
]);
await writeFile(join(__dirname, 'merged', 'timecyc_24h.dat'), manager.merge(), 'utf8');
```

A merge item is `{ path, props?, times?, zones? }`. Each filter restricts **which cells** the donor overwrites;
**an omitted filter means "all" on that axis**. The result is the intersection:

> for every (weather ∈ `zones`) × (hour ∈ `times`) × (property ∈ `props`), copy the donor's value onto the base.

Items apply in array order — a later item wins on overlapping cells.

### Examples

- `{ props: ['Sky top', 'Sky bot'], times: ['20h', '21h', '22h', '23h', '0h', '1h', '2h', '3h', '4h', '5h'] }`
  → only the sky-gradient colours, only those night hours, across **all** weathers.
- `{ zones: ['CLOUDY_VEGAS'] }`
  → the **whole** `CLOUDY_VEGAS` weather (all hours, all properties) replaced by the donor.

## Allowed values

- **`times`** — `'0h'` … `'23h'`.
- **`zones`** — the 23 weather names from `WEATHER_NAMES`: `EXTRASUNNY_LA`, `SUNNY_LA`, `EXTRASUNNY_SMOG_LA`,
  `SUNNY_SMOG_LA`, `CLOUDY_LA`, `SUNNY_SF`, `EXTRASUNNY_SF`, `CLOUDY_SF`, `RAINY_SF`, `FOGGY_SF`, `SUNNY_VEGAS`,
  `EXTRASUNNY_VEGAS`, `CLOUDY_VEGAS`, `EXTRASUNNY_COUNTRYSIDE`, `SUNNY_COUNTRYSIDE`, `CLOUDY_COUNTRYSIDE`,
  `RAINY_COUNTRYSIDE`, `EXTRASUNNY_DESERT`, `SUNNY_DESERT`, `SANDSTORM_DESERT`, `UNDERWATER`, `EXTRACOLOURS_1`,
  `EXTRACOLOURS_2`.
- **`props`** — the SA column labels from `FIELD_LABELS`: `Amb`, `Amb_Obj`, `Dir`, `Sky top`, `Sky bot`,
  `SunCore`, `SunCorona`, `SunSz`, `SprSz`, `SprBght`, `Shdw`, `LightShd`, `PoleShd`, `FarClp`, `FogSt`,
  `LightOnGround`, `LowCloudsRGB`, `BottomCloudRGB`, `WaterRGBA`, `Alpha1`, `RGB1`, `Alpha2`, `RGB2`,
  `CloudAlpha`, `IntensityLimit`, `WaterFogAlpha`, `DirMult`.

Unknown `props` / `zones` / `times` are warned about and skipped (they don't crash the build).

## Notes

- A vanilla input expands to the **21 time-of-day weathers** (504 rows); already-24h files keep all 23 (552
  rows). The game only ever uses the 21 time weathers, so either output is valid; the two `EXTRACOLOURS_*`
  weathers are vestigial.
- The merge logic is a pure function (`timecyc-builder/core/merge.ts` → `mergeTimecyc`), unit-tested in
  `merge.test.ts`; the orchestration + format normalisation is in `core/timecyc-manager.ts`
  (`timecyc-manager.test.ts`). The read/write pair (`parseTimecyc` / `stringifyTimecyc`) and `ensure24h` live
  in the canonical parser and round-trip.
