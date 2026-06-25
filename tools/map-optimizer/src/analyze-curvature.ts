import { ideRefs } from '@opensa/game-build/partition';
import { openArchive } from '@opensa/renderware/archive/img-archive';
import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
/**
 * Phase-0 curvature scan (plan 014). Selects the map instances inside a world-space sphere, scans each unique
 * model's geometry for flat / gently-curved / crease surface, and prints how much of the region is a
 * **refinement target** (large triangles that span real curvature) vs. flat (skip) vs. hard crease (keep
 * sharp). Read-only — measures whether road/terrain smoothing is worth building before any of it exists.
 *
 * Usage: `tsx map-optimizer/src/analyze-curvature.ts [--game original] [--center x,y,z] [--radius 150] [--area 4]`
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { clumpToIr } from './adapters/gta-sa/read';
import {
  type CurvatureMetrics,
  type CurvatureThresholds,
  DEFAULT_THRESHOLDS,
  emptyMetrics,
  mergeMetrics,
  scanGeometry,
} from './analysis/curvature';

interface Instance {
  model: string;
  position: [number, number, number];
}

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function binaryInstances(archives: ReturnType<typeof openArchive>[]): ReturnType<typeof parseBinaryIpl> {
  const out: ReturnType<typeof parseBinaryIpl> = [];
  for (const archive of archives) {
    for (const name of archive.names.filter((entry) => entry.endsWith('.ipl'))) {
      const buffer = archive.get(name);
      if (buffer) {
        out.push(...parseBinaryIpl(buffer));
      }
    }
  }

  return out;
}

/** id → model name (lowercased) from every IDE under the game's data folder. */
function buildIdMap(dataDir: string): Map<number, string> {
  const map = new Map<number, string>();
  for (const file of walk(dataDir).filter((path) => path.toLowerCase().endsWith('.ide'))) {
    for (const [id, ref] of ideRefs(readFileSync(file, 'utf8'))) {
      map.set(id, ref.model.toLowerCase());
    }
  }

  return map;
}

/** Every exterior, non-LOD instance, with its model name resolved by id. */
function collectInstances(
  dataDir: string,
  archives: ReturnType<typeof openArchive>[],
  idToModel: Map<number, string>,
): Instance[] {
  const raw = [...textInstances(dataDir), ...binaryInstances(archives)];
  const out: Instance[] = [];
  for (const instance of raw) {
    if (instance.interior > 0) {
      continue;
    }
    const model = idToModel.get(instance.id) ?? instance.modelName.toLowerCase();
    if (!model || model.startsWith('lod')) {
      continue;
    }
    out.push({ model, position: instance.position });
  }

  return out;
}

function distance(a: readonly number[], b: readonly number[]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function main(): void {
  const game = argValue('--game') ?? 'original';
  const center = (argValue('--center') ?? '2100,1490,15').split(',').map(Number) as [number, number, number];
  const radius = Number(argValue('--radius') ?? 150);
  const thresholds: CurvatureThresholds = { ...DEFAULT_THRESHOLDS, areaThreshold: Number(argValue('--area') ?? 4) };

  const root = process.cwd();
  const gameDir = join(root, 'game-src', game);
  const modelsDir = join(gameDir, 'models');
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`game-src/${game} not found`);
  }

  const archives = readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .map((file) => openArchive(new Uint8Array(readFileSync(join(modelsDir, file)))));
  const getModel = (name: string): ArrayBuffer | null => {
    for (const archive of archives) {
      const bytes = archive.get(name);
      if (bytes) {
        return bytes;
      }
    }

    return null;
  };

  const idToModel = buildIdMap(join(gameDir, 'data'));
  const inRegion = collectInstances(join(gameDir, 'data'), archives, idToModel).filter(
    (instance) => distance(instance.position, center) <= radius,
  );

  report(game, center, radius, thresholds, scanRegion(inRegion, getModel, thresholds));
}

function report(
  game: string,
  center: [number, number, number],
  radius: number,
  thresholds: CurvatureThresholds,
  scanned: { byModel: Map<string, { instances: number; metrics: CurvatureMetrics }>; total: CurvatureMetrics },
): void {
  const { byModel, total } = scanned;
  const edgeTotal = total.edges.flat + total.edges.gentle + total.edges.crease + total.edges.boundary || 1;
  const pct = (n: number): string => `${((100 * n) / edgeTotal).toFixed(0)}%`;
  const areaPct = ((100 * total.refineArea) / (total.totalArea || 1)).toFixed(0);

  console.log(`road-curvature scan — ${game}   center=(${center.join(', ')}) r=${radius}`);
  console.log(`  models     — ${byModel.size} unique scanned`);
  console.log(`  triangles  — ${total.triangles}, ${total.totalArea.toFixed(0)} m² total`);
  console.log(
    `  edges      — flat ${pct(total.edges.flat)}  gentle ${pct(total.edges.gentle)}  ` +
      `crease ${pct(total.edges.crease)}  boundary ${pct(total.edges.boundary)}`,
  );
  console.log(`  large tris — ${total.largeTriangles} (> ${thresholds.areaThreshold} m²)`);
  console.log(
    `  refine     — ${total.refineCandidates} candidate tris, ${total.refineArea.toFixed(0)} m² (${areaPct}% of area)`,
  );

  const top = [...byModel.entries()]
    .filter(([, value]) => value.metrics.refineCandidates > 0)
    .sort((a, b) => b[1].metrics.refineCandidates - a[1].metrics.refineCandidates)
    .slice(0, 10);
  if (top.length > 0) {
    console.log('  top models — (refine candidates × region instances)');
    for (const [model, value] of top) {
      console.log(`    ${model.padEnd(24)} cand=${value.metrics.refineCandidates}  ×${value.instances}`);
    }
  }
}

/** Scan each unique model once; track per-model candidates + how many instances reference it. */
function scanRegion(
  instances: Instance[],
  getModel: (name: string) => ArrayBuffer | null,
  thresholds: CurvatureThresholds,
): { byModel: Map<string, { instances: number; metrics: CurvatureMetrics }>; total: CurvatureMetrics } {
  const counts = new Map<string, number>();
  for (const instance of instances) {
    counts.set(instance.model, (counts.get(instance.model) ?? 0) + 1);
  }

  const byModel = new Map<string, { instances: number; metrics: CurvatureMetrics }>();
  let total = emptyMetrics();
  for (const [model, instanceCount] of counts) {
    const bytes = getModel(`${model}.dff`);
    if (!bytes) {
      continue;
    }
    let metrics = emptyMetrics();
    try {
      for (const mesh of clumpToIr(parseDff(bytes)).meshes) {
        metrics = mergeMetrics(metrics, scanGeometry(mesh.positions, mesh.triangles, thresholds));
      }
    } catch {
      continue; // unparseable model — skip, this is a measurement pass
    }
    byModel.set(model, { instances: instanceCount, metrics });
    total = mergeMetrics(total, metrics);
  }

  return { byModel, total };
}

function textInstances(dataDir: string): ReturnType<typeof parseIpl> {
  return walk(dataDir)
    .filter((file) => file.toLowerCase().endsWith('.ipl') && !/[/\\]interior[/\\]/i.test(file))
    .flatMap((file) => parseIpl(readFileSync(file, 'utf8')));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, out);
    } else {
      out.push(path);
    }
  }

  return out;
}

main();
