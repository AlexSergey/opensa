import { openArchive } from '@opensa/renderware/archive/img-archive';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** An opened IMG archive (engine reader), shared by the IPL scan and the model source. */
export type Archive = ReturnType<typeof openArchive>;

/** Open every `.img` archive under a game's `models/` folder (read-only reuse of the engine reader). */
export function openArchives(modelsDir: string): Archive[] {
  return readdirSync(modelsDir)
    .filter((file) => file.toLowerCase().endsWith('.img'))
    .map((file) => openArchive(new Uint8Array(readFileSync(join(modelsDir, file)))));
}
