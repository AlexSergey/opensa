import { useLoader } from '@react-three/fiber';
import { type ReactElement, useMemo } from 'react';

import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';

import { DFFLoader, TXDLoader } from '../renderware';
import { imgAssetUrl } from './resolve-paths';

interface MapInstanceProps {
  base: string;
  def: IdeObjectDef;
  imgDir: string;
  instance: IplInstance;
}

/**
 * Render one placed IPL instance: load its model + textures (kept in native
 * Z-up so the parent map group handles the world axis), then position and
 * orient a clone at the instance's transform.
 */
export function MapInstance({ base, def, imgDir, instance }: MapInstanceProps): ReactElement {
  const textures = useLoader(TXDLoader, imgAssetUrl(base, imgDir, def.txdName, 'txd'));
  const model = useLoader(DFFLoader, imgAssetUrl(base, imgDir, def.modelName, 'dff'), (loader) => {
    loader.setTextures(textures).setConvertToYUp(false);
  });

  const object = useMemo(() => {
    const clone = model.clone();
    clone.position.set(instance.position[0], instance.position[1], instance.position[2]);
    clone.quaternion.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3]);

    return clone;
  }, [model, instance]);

  return <primitive object={object} />;
}
