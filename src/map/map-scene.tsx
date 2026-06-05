import { type ReactElement, useMemo, useRef } from 'react';
import { type Group } from 'three';

import type { GeometryMode } from '../components/debug/debug-types';
import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';
import type { ImgArchive } from './img-archive';

import { isLodModel } from '../gta-sa-parsers';
import { FitCamera } from './fit-camera';
import { ModelInstances } from './model-instances';
import { modelKey } from './model-key';
import { useGtaMap } from './use-gta-map';

/** Radius (GTA units) loaded around `focus` when a single district is selected. */
const FOCUS_RADIUS = 400;

interface MapSceneProps {
  archive: ImgArchive;
  base: string;
  datUrl: string;
  /** When set: focus the camera here AND load only this district (radius). */
  focus?: [number, number, number];
  geometryMode: GeometryMode;
}

interface ModelGroup {
  def: IdeObjectDef;
  instances: IplInstance[];
}

/**
 * Render a GTA map. Instances are grouped by model so each unique model draws
 * once via InstancedMesh. Keeps exterior (`interior === 0`) instances whose def
 * is known; `geometryMode` selects map vs LOD geometry; a `focus` restricts
 * loading to that district. The root applies the single Z-up→Y-up rotation.
 */
export function MapScene({ archive, base, datUrl, focus, geometryMode }: MapSceneProps): ReactElement {
  const { catalog, instances } = useGtaMap(datUrl, base);
  const groupRef = useRef<Group>(null);

  const models = useMemo(() => {
    const radiusSq = FOCUS_RADIUS * FOCUS_RADIUS;
    const byKey = new Map<string, ModelGroup>();
    for (const instance of instances) {
      const def = catalog.get(instance.id);
      if (!def || instance.interior !== 0) {
        continue;
      }
      const keep = geometryMode === 'lods' ? isLodModel(def.modelName) : !isLodModel(def.modelName);
      if (!keep) {
        continue;
      }
      if (focus) {
        const dx = instance.position[0] - focus[0];
        const dy = instance.position[1] - focus[1];
        if (dx * dx + dy * dy > radiusSq) {
          continue;
        }
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
  }, [catalog, instances, focus, geometryMode]);

  return (
    <>
      <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
        {models.map((model) => (
          <ModelInstances archive={archive} def={model.def} instances={model.instances} key={modelKey(model.def)} />
        ))}
      </group>
      <FitCamera expected={models.length} focus={focus} groupRef={groupRef} />
    </>
  );
}
