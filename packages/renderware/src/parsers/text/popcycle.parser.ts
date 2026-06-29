/** The number of 2-hour time slots per day-type (midnight, 2am, … 10pm). */
export const POPCYCLE_SLOTS = 12;

/** The number of population group weights per row — index-aligned to `cargrp.dat`'s 18 `POPCYCLE_GROUP_*`. */
export const POPCYCLE_GROUPS = 18;

/** One 2-hour time slot of a zone-type's population cycle. */
export interface PopcycleSlot {
  /**
   * Per-group spawn weights, **index-aligned to the 18 `POPCYCLE_GROUP_*` groups** in `cargrp.dat` (the same
   * canonical order: Workers, Business, Clubbers, …, Aircrew_runway). A weighted pick over these chooses the
   * cargrp group whose models a random ambient car is drawn from.
   */
  groupWeights: number[];
  /** The `#Cars` cap — max ambient cars for this zone-type + time. */
  maxCars: number;
}

/** A zone-type's population cycle: 12 weekday + 12 weekend 2-hour slots. */
export interface PopcycleZone {
  weekday: PopcycleSlot[];
  weekend: PopcycleSlot[];
}

/**
 * Parse `popcycle.dat` into a map of **zone-type → population cycle**, keyed by the block name (`BUSINESS`,
 * `INDUSTRY`, `GANGLAND`, …). Each zone-type block is a `// NAME` header sandwiched between `////` separator
 * lines, then a `// Weekday` and a `// Weekend` sub-block of 12 data rows each (2-hour increments). A data row is
 * 24 numbers — `#Peds #Cars Dealers Gang Cops Other` then the 18 group weights — of which we keep `#Cars` and the
 * 18 weights (the `#Peds`/Dealers/Gang/Cops/Other columns drive ped, not car, selection). Rows without 24 columns
 * are skipped.
 */
export function parsePopcycle(text: string): Map<string, PopcycleZone> {
  const lines = text.split(/\r?\n/);
  const zones = new Map<string, PopcycleZone>();
  let current: null | PopcycleZone = null;
  let day: 'weekday' | 'weekend' | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    // A zone-type header is a `// NAME` comment between two `////…` separator lines.
    if (trimmed.startsWith('//') && isSeparator(lines[i - 1]) && isSeparator(lines[i + 1])) {
      const name = trimmed.replace(/^\/+/, '').trim().split(/\s+/)[0];
      if (name && /^[A-Z]/.test(name)) {
        current = { weekday: [], weekend: [] };
        zones.set(name, current);
        day = null;
      }
      continue;
    }
    if (/^\/\/\s*weekday\b/i.test(trimmed)) {
      day = 'weekday';
      continue;
    }
    if (/^\/\/\s*weekend\b/i.test(trimmed)) {
      day = 'weekend';
      continue;
    }

    const code = line.split('//')[0].trim();
    if (current === null || day === null || code === '' || !/^\d/.test(code)) {
      continue;
    }
    const cols = code.split(/\s+/).map(Number);
    if (cols.length < 6 + POPCYCLE_GROUPS || cols.some((value) => !Number.isFinite(value))) {
      continue; // not a full data row
    }
    current[day].push({ groupWeights: cols.slice(6, 6 + POPCYCLE_GROUPS), maxCars: cols[1] });
  }

  return zones;
}

/** The 0-based 2-hour slot index for a game hour (0–23): midnight→0, 2am→1, … 10pm→11. */
export function popcycleSlotForHour(hour: number): number {
  return Math.floor((((hour % 24) + 24) % 24) / 2);
}

function isSeparator(line: string | undefined): boolean {
  return line !== undefined && /^\s*\/{6,}/.test(line);
}
