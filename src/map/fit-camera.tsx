import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useRef } from 'react';
import { Box3, type Group, type PerspectiveCamera, Vector3 } from 'three';

interface FitCameraProps {
  /** How many instances are expected once everything has streamed in. */
  expected: number;
  groupRef: RefObject<Group | null>;
}

/**
 * Frame the camera on the map's bounding box. GTA instances sit at real-world
 * coordinates far from the origin, so a fixed camera usually sees nothing.
 * Refits whenever a new instance appears (child count grows) and stops once the
 * scene is stable, leaving the user free to orbit.
 */
export function FitCamera({ expected, groupRef }: FitCameraProps): null {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as null | { target: Vector3; update: () => void };
  const lastCountRef = useRef(-1);

  useFrame(() => {
    const group = groupRef.current;
    if (!group || expected === 0) {
      return;
    }
    const count = group.children.length;
    if (count === 0 || count === lastCountRef.current) {
      return;
    }

    const box = new Box3().setFromObject(group);
    if (box.isEmpty()) {
      return;
    }

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;

    // Distance that fits maxDim in the vertical FOV, plus a small margin.
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.25;
    const direction = new Vector3(0.5, 0.6, 1).normalize();

    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(0.1, distance / 1000);
    camera.far = distance * 50;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    lastCountRef.current = count;
  });

  return null;
}
