import { useMemo } from 'react';

import type { IdeObjectDef } from '../gta-sa-parsers';
import type { RenderPart } from '../renderware';
import type { ImgArchive } from './img-archive';

import { buildClumpParts } from '../renderware';
import { getClump, getTextures } from './asset-cache';

/**
 * Build (once, cached by name) the single-material render parts for a model,
 * reading its DFF + TXD from the in-memory archive. Each unique model is parsed
 * and built exactly once regardless of how many instances reference it.
 */
export function useModelParts(archive: ImgArchive, def: IdeObjectDef): RenderPart[] {
  return useMemo(
    () => buildClumpParts(getClump(archive, def.modelName), getTextures(archive, def.txdName)),
    [archive, def],
  );
}
