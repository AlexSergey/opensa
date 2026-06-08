interface Field {
  kind: FieldKind;
  name: string;
}

/** One timecyc column group and how to read it. */
type FieldKind = 'float' | 'int' | 'rgb' | 'rgba';

/** timecyc field schema, in file order (RGB = 3 numbers, RGBA = 4, int/float = 1). */
export const FIELDS: readonly Field[] = [
  { kind: 'rgb', name: 'amb' },
  { kind: 'rgb', name: 'ambObj' },
  { kind: 'rgb', name: 'dir' },
  { kind: 'rgb', name: 'skyTop' },
  { kind: 'rgb', name: 'skyBot' },
  { kind: 'rgb', name: 'sunCore' },
  { kind: 'rgb', name: 'sunCorona' },
  { kind: 'float', name: 'sunSize' },
  { kind: 'float', name: 'spriteSize' },
  { kind: 'float', name: 'spriteBright' },
  { kind: 'int', name: 'shadow' },
  { kind: 'int', name: 'lightShadow' },
  { kind: 'int', name: 'poleShadow' },
  { kind: 'float', name: 'farClip' },
  { kind: 'float', name: 'fogStart' },
  { kind: 'float', name: 'lightOnGround' },
  { kind: 'rgb', name: 'lowClouds' },
  { kind: 'rgb', name: 'bottomClouds' },
  { kind: 'rgba', name: 'water' },
  { kind: 'int', name: 'alpha1' },
  { kind: 'rgb', name: 'rgb1' },
  { kind: 'int', name: 'alpha2' },
  { kind: 'rgb', name: 'rgb2' },
  { kind: 'int', name: 'cloudAlpha' },
  { kind: 'int', name: 'intensityLimit' },
  { kind: 'int', name: 'waterFogAlpha' },
  { kind: 'float', name: 'dirMult' },
];

/** The 23 weather names, in table order. The first 21 are time-of-day weathers (24h). */
export const WEATHER_NAMES: readonly string[] = [
  'EXTRASUNNY_LA',
  'SUNNY_LA',
  'EXTRASUNNY_SMOG_LA',
  'SUNNY_SMOG_LA',
  'CLOUDY_LA',
  'SUNNY_SF',
  'EXTRASUNNY_SF',
  'CLOUDY_SF',
  'RAINY_SF',
  'FOGGY_SF',
  'SUNNY_VEGAS',
  'EXTRASUNNY_VEGAS',
  'CLOUDY_VEGAS',
  'EXTRASUNNY_COUNTRYSIDE',
  'SUNNY_COUNTRYSIDE',
  'CLOUDY_COUNTRYSIDE',
  'RAINY_COUNTRYSIDE',
  'EXTRASUNNY_DESERT',
  'SUNNY_DESERT',
  'SANDSTORM_DESERT',
  'UNDERWATER',
  'EXTRACOLOURS_1',
  'EXTRACOLOURS_2',
];

/** Hours per weather in the 24h table. */
export const HOURS = 24;
/** Time-of-day weathers (the first 21; the last 2 are extracolours, not time-based). */
export const TIME_WEATHERS = 21;
/** Keyframes per weather in the vanilla (base) timecyc.dat. */
const KEYFRAMES = 8;

const WIDTH: Record<FieldKind, number> = { float: 1, int: 1, rgb: 3, rgba: 4 };

/**
 * Convert vanilla base rows (23 weathers × 8 keyframes) to 24h rows for the 21
 * time-of-day weathers (21 × 24), by interpolating the fixed GTA keyframe blend
 * (the extracolours/padding the original tool appends are not time-based and are
 * skipped). Float fields round to 2dp, integer/colour fields truncate — matching
 * the reference algorithm.
 */
export function convertTo24h(base: number[][]): number[][] {
  const rows: number[][] = [];
  for (let w = 0; w < TIME_WEATHERS; w += 1) {
    rows.push(...make24h(base.slice(w * KEYFRAMES, w * KEYFRAMES + KEYFRAMES)));
  }

  return rows;
}

/**
 * Parse a timecyc `.dat` (vanilla 8-keyframe or already-24h) into flat numeric
 * rows — one per non-comment line, each {@link FIELDS}-ordered (RGB expanded to
 * its 3 numbers, etc.). Every row is the full field width; missing/unparseable
 * fields get defaults.
 *
 * This faithfully mirrors the reference `timecyc` tool's `getval` (so converting
 * `timecyc.dat` reproduces a bundled `timecyc_24h.dat` byte-for-byte): integer and
 * RGB(A) fields use **strict** integer parsing (a decimal token like `"2.00"` fails
 * — as Python `int()` does), and on failure the read cursor advances exactly as the
 * tool does (int/float skip to `i+i`, RGB to `i+3`, RGBA stays at `i`). On a clean
 * (well-formed) file these quirks never trigger; they only matter for the handful of
 * corrupt vanilla lines.
 */
export function parseTimecyc(text: string): number[][] {
  const rows: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//')) {
      continue;
    }
    rows.push(rowFromTokens(line.split(/\s+/)));
  }

  return rows;
}

/** Per-field interpolation: floats round to 2dp, everything else truncates (GTA convention). */
function interpolate(a: number[], b: number[], f: number): number[] {
  const out: number[] = [];
  let pos = 0;
  for (const field of FIELDS) {
    const width = WIDTH[field.kind];
    for (let c = 0; c < width; c += 1) {
      const value = (1 - f) * a[pos + c] + f * b[pos + c];
      out.push(field.kind === 'float' ? Math.round(value * 100) / 100 : Math.trunc(value));
    }
    pos += width;
  }

  return out;
}

/** Python `float()`: any finite number (accepts decimals), else null. */
function looseFloat(token: string | undefined): null | number {
  if (token === undefined) {
    return null;
  }
  const value = Number(token);

  return Number.isFinite(value) ? value : null;
}

/** The 24 hourly rows for one weather from its 8 keyframes (midnight,5am,6am,7am,midday,7pm,8pm,10pm). */
function make24h(k: number[][]): number[][] {
  return [
    k[0], // midnight
    interpolate(k[0], k[1], 1 / 5),
    interpolate(k[0], k[1], 2 / 5),
    interpolate(k[0], k[1], 3 / 5),
    interpolate(k[0], k[1], 4 / 5),
    k[1], // 5am
    k[2], // 6am
    k[3], // 7am
    interpolate(k[3], k[4], 1 / 5),
    interpolate(k[3], k[4], 2 / 5),
    interpolate(k[3], k[4], 3 / 5),
    interpolate(k[3], k[4], 4 / 5),
    k[4], // midday
    interpolate(k[4], k[5], 1 / 7),
    interpolate(k[4], k[5], 2 / 7),
    interpolate(k[4], k[5], 3 / 7),
    interpolate(k[4], k[5], 4 / 7),
    interpolate(k[4], k[5], 5 / 7),
    interpolate(k[4], k[5], 6 / 7),
    k[5], // 7pm
    k[6], // 8pm
    interpolate(k[6], k[7], 1 / 2),
    k[7], // 10pm
    interpolate(k[7], k[0], 1 / 2),
  ];
}

/** Read one field from the tokens at cursor `i`, mirroring the reference `getval` (incl. its quirks). */
function readField(tokens: string[], i: number, kind: FieldKind): { next: number; values: number[] } {
  if (kind === 'int') {
    const v = strictInt(tokens[i]);

    return v === null ? { next: i + i, values: [-1000] } : { next: i + 1, values: [v] };
  }
  if (kind === 'float') {
    const v = looseFloat(tokens[i]);

    return v === null ? { next: i + i, values: [1] } : { next: i + 1, values: [v] };
  }
  if (kind === 'rgb') {
    const c = [strictInt(tokens[i]), strictInt(tokens[i + 1]), strictInt(tokens[i + 2])];

    return c.some((n) => n === null)
      ? { next: i + 3, values: [-100, -100, -100] }
      : { next: i + 3, values: c as number[] };
  }
  const c = [strictInt(tokens[i]), strictInt(tokens[i + 1]), strictInt(tokens[i + 2]), strictInt(tokens[i + 3])];

  return c.some((n) => n === null)
    ? { next: i, values: [-100, -100, -100, -100] }
    : { next: i + 4, values: c as number[] };
}

function rowFromTokens(tokens: string[]): number[] {
  const row: number[] = [];
  let i = 0;
  for (const field of FIELDS) {
    const { next, values } = readField(tokens, i, field.kind);
    row.push(...values);
    i = next;
  }

  return row;
}

/** Python `int()`: an integer literal only (no decimal point / exponent), else null. */
function strictInt(token: string | undefined): null | number {
  return token !== undefined && /^[+-]?\d+$/.test(token) ? Number(token) : null;
}
