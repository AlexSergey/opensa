import { type Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { TDSLoader } from 'three/addons/loaders/TDSLoader.js';

const PLACEHOLDER_COLOR = 0xff8800;

/**
 * Load the player model.
 *
 * TEMPORARY: the player is a 3ds cube placeholder (`static/player/player.3ds`);
 * a bright material is forced so the untextured cube is clearly visible. This is
 * the seam that later loads a real GTA SA DFF character via the renderware
 * adapter — keep call sites model-agnostic.
 */
export async function loadPlayerMesh(url: string): Promise<Object3D> {
  const model = await new TDSLoader().loadAsync(url);
  model.traverse((node) => {
    const mesh = node as Mesh;
    if (mesh.isMesh) {
      mesh.material = new MeshStandardMaterial({ color: PLACEHOLDER_COLOR });
    }
  });

  return model;
}
