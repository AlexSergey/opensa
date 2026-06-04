import { useFrame, useThree } from '@react-three/fiber';
import { type RefObject, useRef } from 'react';
import { Box3, type Group, type PerspectiveCamera, Vector3 } from 'three';

interface CameraControls {
  target: Vector3;
  update: () => void;
}

interface FitCameraProps {
  /** How many instances are expected once everything has streamed in. */
  expected: number;
  /** Optional GTA Z-up world point to center on instead of fitting the whole map. */
  focus?: [number, number, number];
  groupRef: RefObject<Group | null>;
}

/**
 * Position the camera for the map. With `focus`, it frames a fixed GTA world
 * point (e.g. a neighbourhood) once the controls exist. Without it, it frames
 * the whole scene's bounding box — GTA instances sit far from the origin, so a
 * fixed camera usually sees nothing — refitting as instances stream in.
 */
export function FitCamera({ expected, focus, groupRef }: FitCameraProps): null {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const controls = useThree((state) => state.controls) as CameraControls | null;
  const lastCountRef = useRef(-1);
  const focusedRef = useRef(false);

  useFrame(() => {
    if (focus) {
      if (!focusedRef.current && controls) {
        focusOn(camera, controls, gtaToThree(focus));
        focusedRef.current = true;
      }

      return;
    }

    fitToBounds();
  });

  function fitToBounds(): void {
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
    const fov = (camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.25;

    placeCamera(camera, center, distance, new Vector3(0.5, 0.6, 1));
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    lastCountRef.current = count;
  }

  return null;
}

function focusOn(camera: PerspectiveCamera, controls: CameraControls, target: Vector3): void {
  placeCamera(camera, target, 90, new Vector3(0.35, 0.8, 0.5));
  controls.target.copy(target);
  controls.update();
}

/** Map a GTA Z-up world point into three.js Y-up space (matches the map's −90°X root). */
function gtaToThree(point: [number, number, number]): Vector3 {
  return new Vector3(point[0], point[2], -point[1]);
}

function placeCamera(camera: PerspectiveCamera, target: Vector3, distance: number, dir: Vector3): void {
  camera.position.copy(target).addScaledVector(dir.normalize(), distance);
  camera.near = Math.max(0.5, distance / 1000);
  camera.far = Math.max(8000, distance * 50);
  camera.updateProjectionMatrix();
  camera.lookAt(target);
}
