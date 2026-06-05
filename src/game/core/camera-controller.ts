import { Box3, type Object3D, type PerspectiveCamera, Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/**
 * Owns OrbitControls and frames the camera. `fit-region` is the current mode
 * (frame the bounding box of loaded objects); a `follow-entity` mode (for the
 * player) is a later addition.
 */
export class CameraController {
  private readonly camera: PerspectiveCamera;
  private readonly controls: OrbitControls;

  constructor(camera: PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
  }

  dispose(): void {
    this.controls.dispose();
  }

  /** Frame the bounding box of the given objects (GTA coords are far from origin). */
  frameObjects(objects: Object3D[]): void {
    const box = new Box3();
    for (const object of objects) {
      object.updateMatrixWorld(true);
      box.expandByObject(object);
    }
    if (box.isEmpty()) {
      return;
    }

    const size = box.getSize(new Vector3());
    const center = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const fov = (this.camera.fov * Math.PI) / 180;
    const distance = (maxDim / 2 / Math.tan(fov / 2)) * 1.25;

    this.camera.position.copy(center).addScaledVector(new Vector3(0.5, 0.6, 1).normalize(), distance);
    this.camera.near = Math.max(0.5, distance / 1000);
    this.camera.far = Math.max(8000, distance * 50);
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  update(): void {
    this.controls.update();
  }
}
