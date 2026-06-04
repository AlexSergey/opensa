import { type ReactElement, Suspense } from 'react';

import { MapInstance } from './map-instance';
import { useGtaMap } from './use-gta-map';

interface MapSceneProps {
  base: string;
  datUrl: string;
}

/**
 * Walk every IPL instance of a map and draw the ones whose object definition is
 * known (others — undefined ids or absent assets — are skipped). The group root
 * converts GTA's Z-up world into three.js Y-up once for the whole scene.
 */
export function MapScene({ base, datUrl }: MapSceneProps): ReactElement {
  const { catalog, imgDirs, instances } = useGtaMap(datUrl, base);
  const imgDir = imgDirs[0] ?? 'img';

  return (
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {instances.map((instance): null | ReactElement => {
        const def = catalog.get(instance.id);
        if (!def) {
          return null;
        }

        return (
          <Suspense fallback={null} key={`${instance.id}-${instance.position.join(',')}`}>
            <MapInstance base={base} def={def} imgDir={imgDir} instance={instance} />
          </Suspense>
        );
      })}
    </group>
  );
}
