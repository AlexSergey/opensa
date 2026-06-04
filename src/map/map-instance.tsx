import { useLoader } from '@react-three/fiber';
import { type ReactElement, useMemo } from 'react';

import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';

import { buildClump, TXDLoader } from '../renderware';
import { imgAssetUrl } from './resolve-paths';
import { useClump } from './use-clump';

interface MapInstanceProps {
  base: string;
  def: IdeObjectDef;
  imgDir: string;
  instance: IplInstance;
}

/**
 * Render one placed IPL instance. The TXD (stateless loader, safe to share) and
 * the parsed DFF clump are both loaded under Suspense, so by the time we build
 * the Group both are guaranteed ready — textures can't lose the race. The model
 * is kept in native Z-up; the parent map group converts to Y-up.
 */
export function MapInstance({ base, def, imgDir, instance }: MapInstanceProps): ReactElement {
  const textures = useLoader(TXDLoader, imgAssetUrl(base, imgDir, def.txdName, 'txd'));
  const clump = useClump(imgAssetUrl(base, imgDir, def.modelName, 'dff'));

  const object = useMemo(() => {
    const group = buildClump(clump, textures, { convertToYUp: false });
    group.position.set(instance.position[0], instance.position[1], instance.position[2]);
    group.quaternion.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3]);

    return group;
  }, [clump, textures, instance]);

  return <primitive object={object} />;
}
