import { type ReactElement, Suspense, useMemo, useRef } from 'react';
import { type Group } from 'three';

import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';

import { isLodModel } from '../gta-sa-parsers';
import { FitCamera } from './fit-camera';
import { ModelInstances } from './model-instances';
import { modelKey } from './model-key';
import { useGtaMap } from './use-gta-map';

interface MapSceneProps {
  base: string;
  datUrl: string;
  /** Optional GTA Z-up world point to focus the camera on. */
  focus?: [number, number, number];
}

interface ModelGroup {
  def: IdeObjectDef;
  instances: IplInstance[];
}

/**
 * Render a GTA map. Instances are grouped by model so each unique model draws
 * once via InstancedMesh. We keep only exterior (`interior === 0`), non-LOD
 * instances whose definition is known. The root applies the single Z-up→Y-up
 * rotation; FitCamera frames the scene (or a focus point).
 */
export function MapScene({ base, datUrl, focus }: MapSceneProps): ReactElement {
  const { catalog, imgDirs, instances } = useGtaMap(datUrl, base);
  const imgDir = imgDirs[0] ?? 'img/gta3';
  const groupRef = useRef<Group>(null);

  const models = useMemo(() => {
    const byKey = new Map<string, ModelGroup>();
    for (const instance of instances) {
      const def = catalog.get(instance.id);
      if (!def || instance.interior !== 0 || isLodModel(def.modelName)) {
        continue;
      }
      const key = modelKey(def);
      let group = byKey.get(key);
      if (!group) {
        group = { def, instances: [] };
        byKey.set(key, group);
      }
      group.instances.push(instance);
    }

    return [...byKey.values()];
  }, [catalog, instances]);

  return (
    <>
      <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {models.map((model) => (
          <Suspense fallback={null} key={modelKey(model.def)}>
            <ModelInstances base={base} def={model.def} imgDir={imgDir} instances={model.instances} />
          </Suspense>
        ))}
      </group>
      <FitCamera expected={models.length} focus={focus} groupRef={groupRef} />
    </>
  );
}
