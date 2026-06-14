import { FIELD_LABELS, FIELDS, HOURS, WEATHER_NAMES } from '../../src/renderware/parsers/text/timecyc.parser';

/** A loaded merge source + its selective filters. Any omitted dimension means "all". */
export interface MergeItem {
  props?: readonly string[];
  rows: readonly number[][];
  times?: readonly string[];
  zones?: readonly string[];
}

const WIDTH: Record<string, number> = { float: 1, int: 1, rgb: 3, rgba: 4 };

/** Field label → `[offset, width]` in a flat {@link FIELDS}-ordered row. */
const FIELD_RANGE: ReadonlyMap<string, readonly [number, number]> = ((): Map<string, [number, number]> => {
  const map = new Map<string, [number, number]>();
  let offset = 0;
  FIELDS.forEach((field, index) => {
    map.set(FIELD_LABELS[index], [offset, WIDTH[field.kind]]);
    offset += WIDTH[field.kind];
  });

  return map;
})();

const ROW_SIZE = FIELDS.reduce((total, field) => total + WIDTH[field.kind], 0);

/**
 * Overlay each {@link MergeItem} onto `base`, copying ONLY the cells selected by the intersection of its
 * three filters — zones (weather), times (hour), props (field). An omitted filter means "all" on that axis.
 * Items apply in order (later wins). Pure: returns a fresh row set, `base` untouched.
 */
export function mergeTimecyc(base: readonly number[][], items: readonly MergeItem[]): number[][] {
  const result = base.map((row) => [...row]);

  for (const item of items) {
    const weathers = resolveWeathers(item.zones);
    const hours = resolveHours(item.times);
    const ranges = resolveRanges(item.props);

    for (const w of weathers) {
      for (const h of hours) {
        const index = w * HOURS + h;
        const src = item.rows[index];
        const dst = result[index];
        if (!src || !dst) {
          continue;
        }
        for (const [offset, width] of ranges) {
          for (let i = 0; i < width; i += 1) {
            dst[offset + i] = src[offset + i];
          }
        }
      }
    }
  }

  return result;
}

function resolveHours(times?: readonly string[]): number[] {
  if (!times) {
    return Array.from({ length: HOURS }, (_, h) => h);
  }
  const hours: number[] = [];
  for (const time of times) {
    const match = /^(\d+)h$/.exec(time);
    const hour = match ? Number(match[1]) : NaN;
    if (!Number.isInteger(hour) || hour < 0 || hour >= HOURS) {
      warn(`unknown time '${time}' (expected '0h'..'${HOURS - 1}h')`);
      continue;
    }
    hours.push(hour);
  }

  return hours;
}

function resolveRanges(props?: readonly string[]): (readonly [number, number])[] {
  if (!props) {
    return [[0, ROW_SIZE]]; // the whole row
  }
  const ranges: (readonly [number, number])[] = [];
  for (const prop of props) {
    const range = FIELD_RANGE.get(prop);
    if (!range) {
      warn(`unknown prop '${prop}'`);
      continue;
    }
    ranges.push(range);
  }

  return ranges;
}

function resolveWeathers(zones?: readonly string[]): number[] {
  if (!zones) {
    return WEATHER_NAMES.map((_, index) => index);
  }
  const indices: number[] = [];
  for (const zone of zones) {
    const index = WEATHER_NAMES.indexOf(zone);
    if (index < 0) {
      warn(`unknown zone '${zone}'`);
      continue;
    }
    indices.push(index);
  }

  return indices;
}

function warn(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(`timecyc-builder: ${message}`);
}
