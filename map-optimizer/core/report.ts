/** A model that failed to process (isolated — the run continues). */
export interface AssetFailure {
  error: string;
  name: string;
}

/** Per-model outcome of a run. */
export interface AssetReport {
  /** Plugin names that logged on this asset. */
  applied: string[];
  /** Whether any plugin mutated the geometry (→ re-serialized rather than identity-copied). */
  dirty: boolean;
  name: string;
}

/** The result of one pipeline run. */
export interface RunReport {
  assets: AssetReport[];
  failures: AssetFailure[];
  game: string;
  outDir: string;
}

/** Print a human-readable run summary (mirrors `scripts/build-game.ts` console output). */
export function printReport(report: RunReport): void {
  const changed = report.assets.filter((asset) => asset.dirty).length;
  console.log(`map-optimizer ${report.game}:`);
  console.log(`  models   — ${report.assets.length} processed, ${changed} changed`);
  console.log(`  failures — ${report.failures.length}`);
  for (const failure of report.failures) {
    console.log(`    ✗ ${failure.name}: ${failure.error}`);
  }
  console.log(`  → ${report.outDir}/`);
}
