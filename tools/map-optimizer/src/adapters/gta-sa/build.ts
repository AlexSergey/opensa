import type { ImgArchive } from '@opensa/renderware/archive/img-archive';

import { editArchive } from '@opensa/tool-kit/archive/img';
import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

/** Rebuild a VER2 archive: every entry kept, those present in `optimized` swapped for the optimized bytes. */
export function rebuildArchive(archive: ImgArchive, optimized: Map<string, Uint8Array>): Uint8Array {
  const img = editArchive(archive);
  for (const [name, bytes] of optimized) {
    if (img.has(name)) {
      img.set(name, bytes); // swap an optimized entry in place; keep everything else
    }
  }

  return img.build();
}

/**
 * Full-build output (plan 011): mirror `gameDir` into `outDir`, copying every file verbatim **except** the
 * top-level model archives, which are rebuilt so the optimized entries are swapped in and everything else
 * (vehicles, peds, interiors, …) is preserved. The result is a drop-in `<game>` install.
 */
export function writeFullBuild(
  gameDir: string,
  outDir: string,
  modelArchives: Map<string, ImgArchive>,
  optimized: Map<string, Uint8Array>,
): void {
  for (const file of walk(gameDir)) {
    const rel = relative(gameDir, file);
    if (isModelArchive(rel, modelArchives)) {
      continue; // rebuilt below
    }
    const dest = join(outDir, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(file, dest);
  }

  const modelsOut = join(outDir, 'models');
  mkdirSync(modelsOut, { recursive: true });
  for (const [file, archive] of modelArchives) {
    writeFileSync(join(modelsOut, file), rebuildArchive(archive, optimized));
  }
}

/** A top-level `models/<archive>.img` (rebuilt), vs a loose file or a nested `models/<sub>/…` (copied). */
function isModelArchive(rel: string, modelArchives: Map<string, ImgArchive>): boolean {
  return dirname(rel) === 'models' && modelArchives.has(basename(rel));
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
