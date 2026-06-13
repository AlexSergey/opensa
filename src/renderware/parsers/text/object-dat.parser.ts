/**
 * object.dat collision-damage effect ids (column I) — what an impact does to a prop.
 * `none`/`changeModel` don't shatter; the rest smash into pieces (the break system's gate).
 */
export const ColDamageEffect = {
  /** Shatters; respawns when the cell rebuilds. */
  breakable: 200,
  /** Shatters and is never regenerated. */
  breakableThenRemoved: 202,
  /** Bends to a "_dam" model on hit; no shatter. */
  changeModel: 1,
  /** Swaps to a damaged model first, then shatters on a further hit. */
  changeThenSmash: 21,
  /** Indestructible. */
  none: 0,
  /** Disintegrates completely on a strong enough hit (boxes, bin bags). */
  smashCompletely: 20,
} as const;

/** One `object.dat` row: the physics + collision-damage tuning for a map prop (plan 045). */
export interface ObjectDatEntry {
  /** Collision-damage effect id (column I): 0 none, 1 change_model, 20 smash_completely,
   *  21 change_then_smash, 200 breakable, 202 breakable-then-removed. Informative only — the
   *  break system gates on the presence of RW Breakable mesh data, not this id (the shipped bins /
   *  mailboxes / signs the plan targets carry effect 0 or 1, yet do shatter in game). */
  colDamageEffect: number;
  /** Collision-damage multiplier (column H) — higher takes less force to damage (breaks easier). */
  colDamageMultiplier: number;
  /** Mass (column B); huge values (cutscene/fixed props) mark a prop as effectively indestructible. */
  mass: number;
}

/**
 * Parse `data/object.dat` — SA's per-model object tuning table (plan 045). Whitespace/comma
 * separated columns; `;` comments and blank lines are dropped. Columns:
 * `name mass turnMass airRes elasticity %submerged uproot colDmgMult colDmgEffect …`. Only the
 * fields the break system needs are kept (mass, damage multiplier + effect). Rows with fewer than
 * nine columns or non-numeric damage fields are skipped. Returns a model→entry map (lowercased).
 */
export function parseObjectDat(text: string): Map<string, ObjectDatEntry> {
  const entries = new Map<string, ObjectDatEntry>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith(';')) {
      continue;
    }
    const cells = line.split(/[\s,]+/);
    if (cells.length < 9) {
      continue;
    }
    const mass = Number(cells[1]);
    const colDamageMultiplier = Number(cells[7]);
    const colDamageEffect = Number(cells[8]);
    if (!Number.isFinite(colDamageMultiplier) || !Number.isFinite(colDamageEffect)) {
      continue;
    }
    entries.set(cells[0].toLowerCase(), {
      colDamageEffect,
      colDamageMultiplier,
      mass: Number.isFinite(mass) ? mass : 0,
    });
  }

  return entries;
}
