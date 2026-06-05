/**
 * Renderer-agnostic data model for parsed GTA San Andreas COL collision.
 *
 * One `.col` file is a library of these models, each named to match a DFF model
 * (collision binds to placed objects by name). No three.js types — reusable by
 * the physics/debug layers.
 */
import type { Vec3 } from './types';

/** Axis-aligned bounds + bounding sphere of a collision model. */
export interface ColBounds {
  center: Vec3;
  max: Vec3;
  min: Vec3;
  radius: number;
}

/** A collision primitive box (object-aligned via min/max). */
export interface ColBox {
  max: Vec3;
  min: Vec3;
  surface: ColSurface;
}

/** A collision triangle: vertex indices into {@link ColModel.vertices} + surface. */
export interface ColFace {
  a: number;
  b: number;
  c: number;
  light: number;
  material: number;
}

export interface ColModel {
  bounds: ColBounds;
  boxes: ColBox[];
  faces: ColFace[];
  modelId: number;
  name: string;
  spheres: ColSphere[];
  version: ColVersion;
  /** Decompressed vertex positions in GTA model space (Z-up), flattened (n * 3). */
  vertices: Float32Array;
}

/** A collision primitive sphere. */
export interface ColSphere {
  center: Vec3;
  radius: number;
  surface: ColSurface;
}

/** Per-primitive surface descriptor (material id + lighting bytes). */
export interface ColSurface {
  brightness: number;
  flag: number;
  light: number;
  material: number;
}

export type ColVersion = 1 | 2 | 3 | 4;
