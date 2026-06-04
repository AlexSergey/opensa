import { type ReactElement, Suspense, useRef } from 'react';
import { type Group } from 'three';

import { FitCamera } from './fit-camera';
import { MapInstance } from './map-instance';
import { useGtaMap } from './use-gta-map';

interface MapSceneProps {
  base: string;
  datUrl: string;
}

/**
 * Walk every IPL instance of a map and draw the ones whose object definition is
 * known (others — undefined ids or absent assets — are skipped). The group root
 * converts GTA's Z-up world into three.js Y-up once for the whole scene, and
 * FitCamera frames whatever loads.
 */
export function MapScene({ base, datUrl }: MapSceneProps): ReactElement {
  const { catalog, imgDirs, instances } = useGtaMap(datUrl, base);
  const imgDir = imgDirs[0] ?? 'img';
  const groupRef = useRef<Group>(null);
  const resolvable = instances.filter((instance) => catalog.has(instance.id));

  return (
    <>
      <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {resolvable.map((instance) => (
          <Suspense fallback={null} key={`${instance.id}-${instance.position.join(',')}`}>
            <MapInstance base={base} def={catalog.get(instance.id)!} imgDir={imgDir} instance={instance} />
          </Suspense>
        ))}
      </group>
      <FitCamera expected={resolvable.length} groupRef={groupRef} />
    </>
  );
}
