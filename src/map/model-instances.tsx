import { type ReactElement, useLayoutEffect, useRef } from 'react';
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';
import type { RenderPart } from '../renderware';
import type { ImgArchive } from './img-archive';

import { useModelParts } from './use-model-parts';

interface ModelInstancesProps {
  archive: ImgArchive;
  def: IdeObjectDef;
  instances: IplInstance[];
}

/**
 * Draw every placement of one model. Each single-material part of the model
 * becomes one InstancedMesh whose per-instance matrices are the GTA world
 * transforms composed with the part's local frame. Collapses thousands of
 * repeated objects (poles, palms, lampposts) into a handful of draw calls.
 */
export function ModelInstances({ archive, def, instances }: ModelInstancesProps): ReactElement {
  const parts = useModelParts(archive, def);

  return (
    <>
      {parts.map((part) => (
        <InstancedPart instances={instances} key={part.geometry.uuid} part={part} />
      ))}
    </>
  );
}

function InstancedPart({ instances, part }: { instances: IplInstance[]; part: RenderPart }): ReactElement {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }
    const placement = new Matrix4();
    const composed = new Matrix4();
    const pos = new Vector3();
    const quat = new Quaternion();
    const scale = new Vector3(1, 1, 1);
    instances.forEach((instance, i) => {
      pos.set(instance.position[0], instance.position[1], instance.position[2]);
      quat.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3]);
      placement.compose(pos, quat, scale);
      composed.multiplyMatrices(placement, part.matrix);
      mesh.setMatrixAt(i, composed);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, part]);

  return <instancedMesh args={[part.geometry, part.material, instances.length]} ref={meshRef} />;
}
