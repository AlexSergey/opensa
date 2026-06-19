/**
 * Completeness check (pure): does what the VFS unpacked match what the manifest promised? Compares the
 * delivered chunk count + total entry count to the manifest's totals; returns a list of problems (empty =
 * complete).
 */
import type { Manifest } from '../loaders';

import { allChunks } from '../loaders';

export interface VfsTotals {
  chunks: number;
  entries: number;
}

/** Expected chunk + entry totals from the manifest. */
export function manifestTotals(manifest: Manifest): VfsTotals {
  const chunks = allChunks(manifest);

  return { chunks: chunks.length, entries: chunks.reduce((sum, chunk) => sum + chunk.entries, 0) };
}

/** Problems between expected and actual totals (empty array = complete). */
export function verifyTotals(expected: VfsTotals, got: VfsTotals): string[] {
  const problems: string[] = [];
  if (got.chunks !== expected.chunks) {
    problems.push(`expected ${expected.chunks} chunks, got ${got.chunks}`);
  }
  if (got.entries !== expected.entries) {
    problems.push(`expected ${expected.entries} entries, got ${got.entries}`);
  }

  return problems;
}
