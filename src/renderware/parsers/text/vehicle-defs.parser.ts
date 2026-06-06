import { cleanLines, sectionedParse } from './text-lines';

/** One vehicle definition from `vehicles.ide` (`cars` section). */
export interface VehicleDef {
  gameName: string;
  handlingId: string;
  id: number;
  model: string;
  txd: string;
  type: string;
  /** Wheel model id (-1 = default generic wheel). */
  wheelModelId: number;
  /** Wheel scale [front, rear]. */
  wheelScale: [number, number];
}

/** First column index of the `wheelModelId, wheelScaleFront, wheelScaleRear` triple (car layout). */
const WHEEL_MODEL_COL = 11;

/**
 * Parse `vehicles.ide`'s `cars` section into vehicle definitions keyed by
 * lowercased model name. Columns: `id, model, txd, type, handlingId, gameName,
 * anims, class, frq, flags, comprules, wheelModelId, wheelScaleFront,
 * wheelScaleRear, upgradeClass`. (Plane/boat rows with other layouts are kept but
 * their wheel scale is meaningless — only cars use it.)
 */
export function parseVehicleDefs(text: string): Map<string, VehicleDef> {
  const defs = new Map<string, VehicleDef>();

  sectionedParse(cleanLines(text), {
    cars: (row) => {
      if (row.length <= WHEEL_MODEL_COL + 2) {
        return;
      }
      defs.set(row[1].toLowerCase(), {
        gameName: row[5],
        handlingId: row[4],
        id: Number(row[0]),
        model: row[1],
        txd: row[2],
        type: row[3],
        wheelModelId: Number(row[WHEEL_MODEL_COL]),
        wheelScale: [Number(row[WHEEL_MODEL_COL + 1]), Number(row[WHEEL_MODEL_COL + 2])],
      });
    },
  });

  return defs;
}
