import type { ImgArchive } from '@opensa/renderware/archive/img-archive';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '@opensa/renderware/parsers/text/types';

import { datChildUrl } from '@opensa/renderware/archive/resolve-paths';
import { parseGtaDat } from '@opensa/renderware/parsers/text/gta-dat.parser';
import { parseIde, parseTimedObjects } from '@opensa/renderware/parsers/text/ide.parser';
import { parseBinaryIpl } from '@opensa/renderware/parsers/text/ipl-binary.parser';
import { parseIpl } from '@opensa/renderware/parsers/text/ipl.parser';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Assemble the full {@link MapDefinitions} (object catalog + every placed instance) the engine's collision /
 * procobj-scatter code expects — the offline counterpart of the runtime resolver: catalog from the gta.dat
 * IDEs, instances from the text IPLs under `data/` plus the binary IPL streams inside `gta3.img`.
 */
export function buildMapDefinitions(gamePath: string, archive: ImgArchive): MapDefinitions {
  const dat = parseGtaDat(readFileSync(join(gamePath, 'data', 'gta.dat'), 'utf8'));

  const catalog = new Map<number, IdeObjectDef>();
  for (const idePath of dat.ide) {
    const file = datChildUrl(gamePath, idePath);
    if (!existsSync(file)) {
      continue;
    }
    const text = readFileSync(file, 'utf8');
    for (const def of [...parseIde(text), ...parseTimedObjects(text)]) {
      catalog.set(def.id, def);
    }
  }

  const instances: IplInstance[] = [];
  for (const iplPath of dat.ipl) {
    const file = datChildUrl(gamePath, iplPath);
    if (!iplPath.toLowerCase().endsWith('.zon') && existsSync(file)) {
      instances.push(...parseIpl(readFileSync(file, 'utf8')));
    }
  }
  for (const name of archive.names) {
    if (name.toLowerCase().endsWith('.ipl')) {
      const bytes = new Uint8Array(archive.get(name) ?? new ArrayBuffer(0));
      instances.push(...parseBinaryIpl(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    }
  }

  return { catalog, imgDirs: [], instances, timedCatalog: new Map() };
}
