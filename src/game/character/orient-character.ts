import { Box3, Group, type Object3D, Vector3 } from 'three';

/** How to stand a native character model up in GTA Z-up space. */
export interface CharacterPlacement {
  /** Euler X/Y/Z radians applied to the model so its "up" points along GTA +Z. */
  rotation: [number, number, number];
  /** Uniform scale (SA character units ≈ metres). */
  scale: number;
}

/**
 * Wrap a character model so {@link RenderSyncSystem} — which overwrites the
 * wrapper's position + quaternion every frame from the ECS Transform — does not
 * clobber the model's stand-up correction.
 *
 * The returned wrapper is what the engine syncs/positions; the inner model keeps
 * the {@link CharacterPlacement} rotation/scale that stand it upright, and is
 * shifted so it is centred horizontally on the body and its feet (min Z) rest at
 * the physics box base (−`boxHalfZ`). Coordinates are GTA Z-up (the `entityRoot`
 * applies the −90°X display rotation).
 */
export function orientCharacter(model: Object3D, placement: CharacterPlacement, boxHalfZ: number): Group {
  model.rotation.set(...placement.rotation);
  model.scale.setScalar(placement.scale);
  model.position.set(0, 0, 0);
  model.updateMatrixWorld(true);

  const box = new Box3().setFromObject(model);
  const center = box.getCenter(new Vector3());
  model.position.set(-center.x, -center.y, -boxHalfZ - box.min.z);

  const wrapper = new Group();
  wrapper.name = 'Character';
  wrapper.add(model);

  return wrapper;
}
