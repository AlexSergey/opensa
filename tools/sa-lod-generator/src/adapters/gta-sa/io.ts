import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** An opened IMG archive (engine reader). */
export type Archive = ReturnType<typeof openArchive>;

/** The game's opened model archives: the primary `gta3.img` (for its binary IPL streams) + a lookup across all. */
export interface Archives {
  /** Every opened archive (`gta3.img` first) — for building a texture source across all TXDs. */
  all: Archive[];
  /** Read an entry by name from any archive (`gta3.img` first, then the rest), or `null`. */
  get(name: string): ArrayBuffer | null;
  /** The primary `gta3.img` — holds the binary IPL streams the LOD-link resolution reads. */
  gta3: Archive;
}

/** Open every `.img` under `models/` (read-only reuse of the engine reader); `gta3.img` is required. */
export function openArchives(modelsDir: string): Archives {
  const files = readdirSync(modelsDir).filter((file) => file.toLowerCase().endsWith('.img'));
  const gta3File = files.find((file) => file.toLowerCase() === 'gta3.img');
  if (!gta3File) {
    throw new Error('models/gta3.img not found');
  }
  const archives = new Map(
    files.map((file) => [file, openArchive(new Uint8Array(readFileSync(join(modelsDir, file))))]),
  );
  const gta3 = archives.get(gta3File)!;
  const ordered = [gta3, ...[...archives.entries()].filter(([file]) => file !== gta3File).map(([, a]) => a)];

  return {
    all: ordered,
    get(name: string): ArrayBuffer | null {
      for (const archive of ordered) {
        const bytes = archive.get(name);
        if (bytes) {
          return bytes;
        }
      }

      return null;
    },
    gta3,
  };
}
