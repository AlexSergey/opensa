import type { Matrix4 } from 'three';

import type { Vec3 } from './world-adapter.interface';

/**
 * Generic, engine-side collision data — the seam a physics system (Rapier, a
 * later plan) consumes. The world adapter converts its renderware-specific
 * collision into these plain shapes, so the `game` layer stays free of
 * renderware types. Coordinates are model space (GTA Z-up), like the render;
 * the physics layer bakes its own world transform.
 */

/** A collision primitive box (object-aligned via min/max). */
export interface ColliderBox {
  max: Vec3;
  min: Vec3;
}

/** A model's collision: a triangle mesh plus primitive boxes/spheres. */
export interface ColliderShape {
  boxes: ColliderBox[];
  /** Triangle indices into `vertices` (3 per triangle). */
  indices: Uint32Array;
  spheres: ColliderSphere[];
  /** Flattened vertex positions (n * 3). */
  vertices: Float32Array;
}

/** A collision primitive sphere. */
export interface ColliderSphere {
  center: Vec3;
  radius: number;
}

/** One model's collision shape + the world placements of every instance of it. */
export interface ModelColliders {
  /** Breakable-prop instance keys aligned with {@link transforms} (plan 045) — present only for
   *  smashable models, so the physics layer can drop one instance's body when the prop is broken. */
  instanceKeys?: readonly string[];
  name: string;
  shape: ColliderShape;
  /** World transforms (GTA Z-up; same convention as the render). */
  transforms: Matrix4[];
}
