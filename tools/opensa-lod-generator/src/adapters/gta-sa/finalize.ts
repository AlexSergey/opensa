import type { Vec3 } from '@opensa/sa-lod/mesh';
import type { TextureSource } from '@opensa/sa-lod/texture-source';

import { encodeColLibrary } from '@opensa/sa-lod/encode-col';
import { encodeLodDff } from '@opensa/sa-lod/encode-dff';
import { encodeLodTxd } from '@opensa/sa-lod/encode-txd';
import { createImg } from '@opensa/tool-kit/archive/img';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BakedCell } from '../../core/types';

export interface BuildOptions {
  baked: readonly BakedCell[];
  cellSize: number;
  drawDistance: number;
  firstId: number;
  gameDir: string;
  lodTextureSize: number;
  outDir: string;
  textureSource: TextureSource;
}

/** Cell centre in world space (Z 0 — the cell mesh keeps world Z, offset only in X/Y; see merge). */
export function cellCentre(cell: { cx: number; cy: number }, cellSize: number): [number, number, number] {
  return [(cell.cx + 0.5) * cellSize, (cell.cy + 0.5) * cellSize, 0];
}

/** The cell-LOD model/txd name (`lod`-prefixed → OpenSA buckets it; `-` for negative cell coords). */
export function cellModelName(cx: number, cy: number): string {
  return `lod_${cx}_${cy}`;
}

/** An IDE `objs` line: `id, model, txd, drawDistance, flags`. */
export function ideObjsLine(id: number, name: string, drawDistance: number): string {
  return `${id}, ${name}, ${name}, ${drawDistance}, 0`;
}

/** An IPL `inst` line: `id, model, interior, x, y, z, rx, ry, rz, rw, lod` (identity rotation, no LOD link). */
export function iplInstLine(id: number, name: string, [x, y, z]: readonly [number, number, number]): string {
  return `${id}, ${name}, 0, ${x}, ${y}, ${z}, 0, 0, 0, 1, -1`;
}

/** Local AABB of a cell mesh's vertices — the bounds for its (faces-less) COL3 model. */
export function meshBounds(mesh: { positions: Float32Array }): { max: Vec3; min: Vec3 } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    for (let a = 0; a < 3; a += 1) {
      min[a] = Math.min(min[a], p[i + a]);
      max[a] = Math.max(max[a], p[i + a]);
    }
  }

  return p.length === 0 ? { max: [0, 0, 0], min: [0, 0, 0] } : { max, min };
}

/**
 * Emit the drop-in cell-LOD build (plan 002, 1d-ii). Mirror `gameDir` → `outDir`, then add a single
 * `models/lods.img` (one DFF + one TXD per baked cell, plus one shared `lods.col` of bounds-only COL3 models so
 * SA has collision to stream them), `data/maps/lods.ide` (cell-LOD object defs) + `data/maps/lods.ipl`
 * (placements at each cell centre), and register all three in `data/gta.dat` — so both OpenSA (lod-prefix bucket) and the original
 * game (independent high-draw-distance objects) load them. **Additive**: old `lod*` models/refs are not yet
 * stripped (follow-up), so they coexist with the new cell-LODs.
 */
export function writeBuild(options: BuildOptions): void {
  cpSync(options.gameDir, options.outDir, { force: true, recursive: true });

  const img = createImg();
  const objs: string[] = [];
  const insts: string[] = [];
  const colNames: string[] = [];
  const colBounds: { max: Vec3; min: Vec3 }[] = [];
  options.baked.forEach((cell, i) => {
    const id = options.firstId + i;
    const name = cellModelName(cell.cx, cell.cy);
    // Two-sided: this build targets OpenSA, which back-face-culls opaque world materials; a merged cell's
    // inconsistent winding would hole the ground otherwise (the real game renders single-sided fine).
    img.set(`${name}.dff`, encodeLodDff(cell.mesh, name, { doubleSided: true }));
    img.set(`${name}.txd`, encodeLodTxd(cellTextures(cell), options.textureSource, options.lodTextureSize));
    objs.push(ideObjsLine(id, name, options.drawDistance));
    insts.push(iplInstLine(id, name, cellCentre(cell, options.cellSize)));
    colNames.push(name);
    colBounds.push(meshBounds(cell.mesh));
  });
  // SA faults on any streamed model with no collision (fastman92: MODEL_DOES_NOT_HAVE_COLLISION_LOADED). The LODs
  // need no real collision, so pack one bounds-only COL3 per cell (named to its model); SA auto-discovers .col in
  // the IMG. Same approach as lod-procobj-generator / lod-trees-generator.
  img.set('lods.col', encodeColLibrary(colBounds, colNames));

  writeFileSync(join(options.outDir, 'models', 'lods.img'), img.build());
  const mapsDir = join(options.outDir, 'data', 'maps');
  mkdirSync(mapsDir, { recursive: true });
  writeFileSync(join(mapsDir, 'lods.ide'), section('objs', objs));
  writeFileSync(join(mapsDir, 'lods.ipl'), section('inst', insts));
  registerInGtaDat(join(options.outDir, 'data', 'gta.dat'));
}

/** Unique non-empty texture names a cell references. */
function cellTextures(cell: BakedCell): string[] {
  return [...new Set(cell.mesh.groups.map((group) => group.texture).filter((texture) => texture.length > 0))];
}

function registerInGtaDat(datPath: string): void {
  const lines = ['IMG MODELS\\lods.img', 'IDE DATA\\MAPS\\lods.ide', 'IPL DATA\\MAPS\\lods.ipl'];
  writeFileSync(datPath, `${readFileSync(datPath, 'utf8').trimEnd()}\n${lines.join('\n')}\n`);
}

function section(name: string, rows: readonly string[]): string {
  return `${name}\n${rows.join('\n')}\nend\n`;
}
