import { useMemo } from 'react';

import type { IdeObjectDef } from '../gta-sa-parsers';
import type { RenderPart } from '../renderware';

import { buildClumpParts } from '../renderware';
import { imgAssetUrl } from './resolve-paths';
import { useClump } from './use-clump';
import { useTextures } from './use-textures';

/**
 * Build (once, cached by url) the single-material render parts for a model.
 * TXD goes through the stateless `TXDLoader` and the DFF through `useClump`
 * (cached parse), so concurrent models don't race over textures, and each
 * unique model is parsed + built exactly once regardless of how many instances
 * reference it.
 */
export function useModelParts(base: string, imgDir: string, def: IdeObjectDef): RenderPart[] {
  const textures = useTextures(imgAssetUrl(base, imgDir, def.txdName, 'txd'));
  const clump = useClump(imgAssetUrl(base, imgDir, def.modelName, 'dff'));

  return useMemo(() => buildClumpParts(clump, textures), [clump, textures]);
}
