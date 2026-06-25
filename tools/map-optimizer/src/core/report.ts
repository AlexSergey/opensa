import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A model that failed to process (isolated — the run continues). */
export interface AssetFailure {
  error: string;
  name: string;
}

/** Per-model outcome of a run, with before/after stats. */
export interface AssetReport {
  /** Plugin names that logged on this asset. */
  applied: string[];
  bytesAfter: number;
  bytesBefore: number;
  /** Whether any plugin mutated the geometry (→ re-serialized rather than identity-copied). */
  dirty: boolean;
  name: string;
  trianglesAfter: number;
  trianglesBefore: number;
  verticesAfter: number;
  verticesBefore: number;
}

/** The result of one pipeline run. */
export interface RunReport {
  assets: AssetReport[];
  failures: AssetFailure[];
  game: string;
  outDir: string;
}

/** Aggregate run totals (pure — no I/O). */
export interface RunSummary {
  bytesAfter: number;
  bytesBefore: number;
  changed: number;
  failures: number;
  models: number;
  trianglesRemoved: number;
  verticesRemoved: number;
}

/** Print a human-readable run summary (mirrors `scripts/build-game.ts` console output). */
export function printReport(report: RunReport): void {
  const totals = summarizeReport(report);
  const saved = totals.bytesBefore - totals.bytesAfter;
  const percent = totals.bytesBefore > 0 ? (Math.abs(saved / totals.bytesBefore) * 100).toFixed(1) : '0.0';
  // A negative "removed" means the pass ADDED (split vertices, normal blocks, …); show it honestly.
  const delta = (n: number): string => (n >= 0 ? `${n} removed` : `${-n} added`);
  console.log(`map-optimizer ${report.game}:`);
  console.log(`  models   — ${totals.models} processed, ${totals.changed} changed`);
  console.log(`  vertices — ${delta(totals.verticesRemoved)}`);
  console.log(`  faces    — ${delta(totals.trianglesRemoved)}`);
  console.log(
    `  size     — ${kb(totals.bytesBefore)} → ${kb(totals.bytesAfter)} (${percent}% ${saved >= 0 ? 'smaller' : 'larger'})`,
  );
  console.log(`  failures — ${totals.failures}`);
  for (const failure of report.failures) {
    console.log(`    ✗ ${failure.name}: ${failure.error}`);
  }
  console.log(`  → ${report.outDir}/`);
}

/** Compute the run totals from per-asset reports. */
export function summarizeReport(report: RunReport): RunSummary {
  const totals: RunSummary = {
    bytesAfter: 0,
    bytesBefore: 0,
    changed: 0,
    failures: report.failures.length,
    models: report.assets.length,
    trianglesRemoved: 0,
    verticesRemoved: 0,
  };
  for (const asset of report.assets) {
    totals.bytesBefore += asset.bytesBefore;
    totals.bytesAfter += asset.bytesAfter;
    totals.verticesRemoved += asset.verticesBefore - asset.verticesAfter;
    totals.trianglesRemoved += asset.trianglesBefore - asset.trianglesAfter;
    if (asset.dirty) {
      totals.changed += 1;
    }
  }

  return totals;
}

/** Write the full run report as JSON to `report.json` in the output dir (for tooling / diffing). */
export function writeReport(report: RunReport): void {
  writeFileSync(join(report.outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} KB`;
}
