import { type ThreeEvent } from '@react-three/fiber';
import { type ReactElement, useLayoutEffect, useRef } from 'react';
import { type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';

import type { IdeObjectDef, IplInstance } from '../gta-sa-parsers';
import type { RenderPart } from '../renderware';
import type { ImgArchive } from './img-archive';

import { debugState } from '../components/debug/debug-state';
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
        <InstancedPart def={def} instances={instances} key={part.geometry.uuid} part={part} />
      ))}
    </>
  );
}

function InstancedPart({
  def,
  instances,
  part,
}: {
  def: IdeObjectDef;
  instances: IplInstance[];
  part: RenderPart;
}): ReactElement {
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
      // GTA SA IPL quaternions are the inverse of three.js's convention — conjugate.
      quat.set(instance.rotation[0], instance.rotation[1], instance.rotation[2], instance.rotation[3]).conjugate();
      placement.compose(pos, quat, scale);
      composed.multiplyMatrices(placement, part.matrix);
      mesh.setMatrixAt(i, composed);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [instances, part]);

  // TEMPORARY: while the debug popup is open, clicking a model reports it.
  function handleClick(event: ThreeEvent<MouseEvent>): void {
    if (!debugState.isEnabled() || event.instanceId === undefined) {
      return;
    }
    event.stopPropagation();
    const instance = instances[event.instanceId];
    debugState.select({ modelName: def.modelName, position: instance.position, txdName: def.txdName });
  }

  return <instancedMesh args={[part.geometry, part.material, instances.length]} onClick={handleClick} ref={meshRef} />;
}
