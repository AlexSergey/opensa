/**
 * vehicle-optimizer CLI. Works on a loose vehicle DFF given by `--model <path>` (resolved **relative to this
 * cli.ts**). With no operation it prints a structure report; with `--scale` and/or `--prototype <path>` it writes
 * the finished DFF to `vehicle-optimizer/out/<filename>`. Usage:
 * `tsx vehicle-optimizer/src/cli.ts --model <path-to-dff> [--scale <factor>] [--prototype <path-to-dff>]`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGtaSaVehicleAdapter } from './adapters/gta-sa';
import { printReport } from './core';

/** Paths on the command line are resolved relative to this file's directory. */
const HERE = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);

  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const model = argValue('--model');
  if (!model) {
    throw new Error(
      'usage: tsx vehicle-optimizer/src/cli.ts --model <path-to-dff> [--scale <factor>] [--prototype <path-to-dff>]',
    );
  }

  const modelPath = resolve(HERE, model);
  const dff = new Uint8Array(readFileSync(modelPath));
  const adapter = createGtaSaVehicleAdapter();

  const scale = argValue('--scale');
  const prototype = argValue('--prototype');
  if (!scale && !prototype) {
    printReport(adapter.inspect(dff, basename(modelPath)));

    return;
  }

  const bytes = adapter.process(dff, {
    prototype: prototype ? new Uint8Array(readFileSync(resolve(HERE, prototype))) : undefined,
    scale: scale ? Number(scale) : undefined,
  });
  const outDir = resolve(HERE, '..', 'out');
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, basename(modelPath));
  writeFileSync(outPath, bytes);
  console.log(`→ ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
