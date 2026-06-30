import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { ProcObjPlacement } from '@opensa/renderware/map/procobj-scatter';

import { buildColliders } from '@opensa/renderware/collision/build-colliders';
import { buildCollisionIndex } from '@opensa/renderware/collision/collision-index';
import { groupRulesBySurface, scatterProcObjects } from '@opensa/renderware/map/procobj-scatter';
import { parseProcObj } from '@opensa/renderware/parsers/text/procobj.parser';
import { parseSurfaceNames } from '@opensa/renderware/parsers/text/surfinfo.parser';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { disableProcObj, stripProcObj, UNDERWATER_PROCOBJ } from '../procobj-strip';
import { buildMapDefinitions } from './world';

export interface ProcObjConvertOptions {
  archive: ImgArchive;
  /** `--modloader`: emit `procobj.dat` as **disable rows** (converted species' scatter set to zero, replacing the
   *  stock rule by surface+model on additive merge) instead of a stripped whole file — so the strip survives a
   *  Modloader additive `.dat` merge (which would re-add omitted species from stock). Default (false): strip. */
  disableScatter?: boolean;
  gamePath: string;
  /** Only convert species whose HD bbox is at least this tall (excludes grass/small bushes). 0 = no gate. */
  heightThreshold: number;
  /** Base name for the emitted IPL (`data/maps/<iplName>.ipl` + the `gta.dat` line) — e.g. `lod_procobj`. */
  iplName: string;
  outPath: string;
  /** Safety cap on total placed objects (HD count); the set is thinned to the lowest-lottery survivors. */
  procObjMax: number;
  /** sourceName → registration. Only models that have a generated LOD are candidates. */
  species: ReadonlyMap<string, ProcObjSpecies>;
}

/** Per converted species: the stock HD model id + its generated LOD (id/model name) + bbox height (the gate). */
export interface ProcObjSpecies {
  hdId: number;
  height: number;
  lodId: number;
  lodModel: string;
}

/**
 * Convert `--dff ∩ procobj` species from runtime scatter into static IPL instances: reuse the engine's vanilla
 * `scatterProcObjects`, thin it (MINDIST min-spacing + a global cap — static can't materialise the full runtime
 * density), emit each as an HD instance + its LOD (text-internal `lod`), and stop those species scattering at
 * runtime via `procobj.dat` (stripped, or disable rows under `disableScatter`). {@link UNDERWATER_PROCOBJ} species
 * are never converted (seabed scatter). Returns the gta.dat IPL line to register (or null when nothing qualifies).
 */
export function convertProcObj(options: ProcObjConvertOptions): null | { datLine: string; objects: number } {
  const { archive, disableScatter, gamePath, heightThreshold, iplName, outPath, procObjMax, species } = options;
  const procObjText = readFileSync(join(gamePath, 'data', 'procobj.dat'), 'utf8');

  // Candidate species: have a LOD, clear the optional height gate, and are not the never-touch underwater set.
  const eligible = new Set(
    [...species]
      .filter(([model, s]) => s.height >= heightThreshold && !UNDERWATER_PROCOBJ.has(model.toLowerCase()))
      .map(([model]) => model),
  );
  const rules = parseProcObj(procObjText).filter((rule) => eligible.has(rule.model));
  if (rules.length === 0) {
    return null;
  }
  const converted = new Set(rules.map((rule) => rule.model));
  const minDistByModel = new Map<string, number>();
  for (const rule of rules) {
    minDistByModel.set(rule.model, Math.max(minDistByModel.get(rule.model) ?? 0, rule.minDistance));
  }

  // Scatter (vanilla) over the whole map, then thin per species by MINDIST, then a global lowest-lottery cap.
  const defs = buildMapDefinitions(gamePath, archive);
  const colliders = buildColliders(buildCollisionIndex(archive), defs, { center: [0, 0, 0], radius: Infinity });
  const surfaceNames = parseSurfaceNames(readFileSync(join(gamePath, 'data', 'surfinfo.dat'), 'utf8'));
  const batches = scatterProcObjects(colliders, groupRulesBySurface(rules), surfaceNames, 0, 0);

  const placed: { model: string; placement: ProcObjPlacement }[] = [];
  for (const batch of batches) {
    const vanilla = batch.placements.filter((placement) => placement.lottery < 1);
    for (const placement of cullByMinDistance(vanilla, minDistByModel.get(batch.model) ?? 0)) {
      placed.push({ model: batch.model, placement });
    }
  }
  placed.sort((a, b) => a.placement.lottery - b.placement.lottery);
  const final = placed.slice(0, procObjMax);

  // Emit <iplName>.ipl: per object an HD instance (lod → its LOD) + the LOD instance (leaf).
  const rows: string[] = [];
  final.forEach(({ model, placement }, i) => {
    const s = species.get(model)!;
    const t = [...placement.position, ...iplQuaternion(placement.rotation)].join(', ');
    rows.push(`${s.hdId}, ${model}, 0, ${t}, ${2 * i + 1}`); // HD → the LOD row that follows
    rows.push(`${s.lodId}, ${s.lodModel}, 0, ${t}, -1`); // LOD (leaf)
  });
  writeText(
    join(outPath, 'data', 'maps', `${iplName}.ipl`),
    ['# Generated by @opensa/map-placement — procobj → static', 'inst', ...rows, 'end', ''].join('\r\n'),
  );

  // Stop the converted species scattering at runtime (they're now static). `--out` strips them from a whole-file
  // procobj.dat; `--modloader` emits disable rows instead, so a Modloader additive `.dat` merge can't re-add them.
  writeText(
    join(outPath, 'data', 'procobj.dat'),
    disableScatter
      ? disableProcObj(procObjText, (m) => converted.has(m))
      : stripProcObj(procObjText, (m) => !converted.has(m.toLowerCase())).text,
  );

  return { datLine: `IPL DATA\\MAPS\\${iplName}.IPL`, objects: final.length };
}

/** Greedy min-distance (XY) cull, spatial-hashed; input is already lottery-sorted so the lowest survive. */
export function cullByMinDistance(placements: readonly ProcObjPlacement[], minDist: number): ProcObjPlacement[] {
  if (minDist <= 0) {
    return [...placements];
  }
  const grid = new Map<string, ProcObjPlacement[]>();
  const minSq = minDist * minDist;
  const kept: ProcObjPlacement[] = [];
  for (const placement of placements) {
    const gx = Math.floor(placement.position[0] / minDist);
    const gy = Math.floor(placement.position[1] / minDist);
    if (!tooClose(grid, gx, gy, placement, minSq)) {
      kept.push(placement);
      const key = `${gx},${gy}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push(placement);
    }
  }

  return kept;
}

/** GTA IPL rotation quaternion for a yaw around Z (conjugated, the IPL convention; align is unused). */
export function iplQuaternion(yaw: number): [number, number, number, number] {
  return [0, 0, -Math.sin(yaw / 2), Math.cos(yaw / 2)];
}

function tooClose(
  grid: ReadonlyMap<string, ProcObjPlacement[]>,
  gx: number,
  gy: number,
  p: ProcObjPlacement,
  minSq: number,
): boolean {
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (const q of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
        const ddx = p.position[0] - q.position[0];
        const ddy = p.position[1] - q.position[1];
        if (ddx * ddx + ddy * ddy < minSq) {
          return true;
        }
      }
    }
  }

  return false;
}

function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}
