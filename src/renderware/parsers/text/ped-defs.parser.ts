import { cleanLines, sectionedParse } from './text-lines';

/** A ped definition from an IDE `peds` section (only the fields we need). */
export interface PedDef {
  id: number;
  /** DFF base name (no extension). */
  model: string;
  /** TXD base name (no extension). */
  txd: string;
}

/**
 * Parse an IDE file's `peds` section into `lowercased model name → def`. Columns:
 * `id, model, txd, pedType, behavior, animGroup, carsCanDrive, ...` — we keep the first three. Used to
 * resolve a ped model (e.g. the temporary `VITE_MAIN_CHARACTER`) to its archive `model.dff` / `txd.txd`.
 */
export function parsePedDefs(text: string): Map<string, PedDef> {
  const defs = new Map<string, PedDef>();
  sectionedParse(cleanLines(text), {
    peds: (row) => {
      if (row.length < 3) {
        return;
      }
      defs.set(row[1].toLowerCase(), { id: Number(row[0]), model: row[1], txd: row[2] });
    },
  });

  return defs;
}
