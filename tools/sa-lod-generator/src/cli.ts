/**
 * sa-lod-generator CLI. Takes `--game <path>` (a game-data dir: `data/` + `models/`), resolves the map's HD↔LOD
 * links and prints a sizing report — stock LODs vs full HD clones (plan 002, Phase 1). With `--out <path>` it bakes
 * the drop-in build: every per-object LOD becomes a verbatim HD clone with a `--tex-scale` (default 0.5) TXD. Usage:
 * `tsx sa-lod-generator/src/cli.ts --game <path> [--out <path>] [--tex-scale 0.5]`. Paths are relative to the
 * current working directory (absolute paths pass through).
 */
import { statSync } from 'node:fs';
import { basename, isAbsolute, resolve } from 'node:path';

import { createSaLodAdapter } from './adapters/gta-sa';
import { printReport } from './core';
import { config } from './lod.config';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fromCwd(value: string): string {
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

function main(): void {
  const gameArg = argValue('--game');
  if (!gameArg) {
    throw new Error('usage: tsx sa-lod-generator/src/cli.ts --game <path> [--out <path>] [--tex-scale 0.5]');
  }
  const gameDir = fromCwd(gameArg);
  if (!statSync(gameDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`--game must be a game-data directory: ${gameDir}`);
  }

  const label = basename(gameDir);
  const texScale = Number(argValue('--tex-scale') ?? config.texScale);
  const adapter = createSaLodAdapter(label, gameDir, { ...config, texScale });
  const resolved = adapter.resolvePairs();
  printReport(label, adapter.report(resolved));
  console.log(
    `  excluded ${resolved.excludedDualRole} dual-role + ${resolved.excludedVegetation} vegetation LODs (kept stock)`,
  );

  const outArg = argValue('--out');
  if (outArg !== undefined) {
    const outDir = fromCwd(outArg);
    const stats = adapter.finalize(outDir, resolved);
    console.log(
      `  baked ${stats.clonedLods} LOD clones + ${stats.generatedTxds} TXDs @ ${texScale}× (shared ${stats.skippedShared}, missing HD ${stats.missingHd}, missing TXD ${stats.missingTxd})`,
    );
    console.log(`  retargeted ${stats.retransformedLods} LOD instances to their HD transform`);
    console.log(
      `  filled ${stats.filledHoles} missing-LOD holes (${stats.filledInstances} instances, ${stats.skippedHoles} skipped)`,
    );
    console.log(`→ ${outDir}`);
  }
}

main();
