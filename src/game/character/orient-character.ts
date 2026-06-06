import { Group, type Object3D } from 'three';

/** How to place a character model inside its wrapper (GTA Z-up space). */
export interface CharacterPlacement {
  /** Position offset (GTA Z-up) — fine-tunes the feet to the box base. Default [0,0,0]. */
  offset?: [number, number, number];
  /** Euler X/Y/Z radians. Identity for an animated ped — the idle/walk clip stands it up. */
  rotation: [number, number, number];
  /** Uniform scale (SA character units ≈ metres). */
  scale: number;
}

/**
 * Wrap a character model so {@link RenderSyncSystem} — which overwrites the
 * wrapper's position + quaternion every frame from the ECS Transform — does not
 * clobber the model's placement.
 *
 * The returned wrapper is what the engine syncs/positions; the inner model keeps
 * the {@link CharacterPlacement} rotation/scale/offset. For an animated GTA ped
 * the animation orients the skeleton into GTA Z-up (so `rotation` is identity)
 * and the model origin (pelvis) sits at the box centre; `offset` nudges the feet
 * onto the box base. Coordinates are GTA Z-up (the `entityRoot` applies the −90°X
 * display rotation).
 */
export function orientCharacter(model: Object3D, placement: CharacterPlacement): Group {
  model.rotation.set(...placement.rotation);
  model.scale.setScalar(placement.scale);
  model.position.set(...(placement.offset ?? [0, 0, 0]));

  const wrapper = new Group();
  wrapper.name = 'Character';
  wrapper.add(model);

  return wrapper;
}
