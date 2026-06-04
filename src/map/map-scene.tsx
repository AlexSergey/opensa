import { type ReactElement, Suspense, useRef } from 'react';
import { type Group } from 'three';

import { isLodModel } from '../gta-sa-parsers';
import { FitCamera } from './fit-camera';
import { MapInstance } from './map-instance';
import { useGtaMap } from './use-gta-map';

interface MapSceneProps {
  base: string;
  datUrl: string;
  /** Optional GTA Z-up world point to focus the camera on. */
  focus?: [number, number, number];
}

/**
 * Walk every IPL instance of a map and draw the ones whose object definition is
 * known (others — undefined ids or absent assets — are skipped). The group root
 * converts GTA's Z-up world into three.js Y-up once for the whole scene, and
 * FitCamera frames whatever loads.
 */
export function MapScene({ base, datUrl, focus }: MapSceneProps): ReactElement {
  const { catalog, imgDirs, instances } = useGtaMap(datUrl, base);
  const imgDir = imgDirs[0] ?? 'img';
  const groupRef = useRef<Group>(null);
  // Render full-detail objects whose definition is known; skip distant LOD stand-ins.
  // Resolve the model name from the catalog def — binary-stream instances carry none.
  const resolvable = instances.filter((instance) => {
    const def = catalog.get(instance.id);

    return def !== undefined && !isLodModel(def.modelName);
  });

  return (
    <>
      <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {resolvable.map((instance) => (
          <Suspense fallback={null} key={`${instance.id}-${instance.position.join(',')}`}>
            <MapInstance base={base} def={catalog.get(instance.id)!} imgDir={imgDir} instance={instance} />
          </Suspense>
        ))}
      </group>
      <FitCamera expected={resolvable.length} focus={focus} groupRef={groupRef} />
    </>
  );
}
