import type { Texture } from 'three';
import type { MeshStandardMaterial } from 'three';

import { DoubleSide, Group, Matrix4, Mesh, Vector3 } from 'three';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { buildGeometry, buildMaterial, frameMatrix } from './build-clump';

/** Paint + wheel options resolved from carcols/vehicles.ide. */
export interface VehicleOptions {
  /** Primary paint RGB (0-255), replaces the `(60,255,0)` marker. */
  primary: [number, number, number];
  /** Secondary paint RGB (0-255), replaces the `(255,0,175)` marker. */
  secondary: [number, number, number];
  /** Wheel scale `[front, rear]` from vehicles.ide. */
  wheelScale: [number, number];
}

/** Material marker colours that the carcol paint replaces. */
const PRIMARY_MARKER: [number, number, number] = [60, 255, 0];
const SECONDARY_MARKER: [number, number, number] = [255, 0, 175];

/** The single wheel atomic, instanced at each `wheel_*_dummy`. */
const WHEEL_FRAME = 'wheel';

/** Wheels read a touch small from the vehicles.ide scale alone; nudge them up in-engine. */
const WHEEL_SCALE_BOOST = 1.25;

/**
 * Build a renderable vehicle from its DFF clump. Renders the body (chassis +
 * each `*_ok` component atomic, placed by its frame's **world** transform),
 * skipping `*_dam` (damaged) and `*_vlo` (LOD) parts and the bare `wheel`
 * atomic. The wheel is instanced at the four `wheel_*_dummy` frames, scaled per
 * front/rear and mirrored on the right side. Paint markers in material colours
 * are replaced by the carcol primary/secondary. Result stays in native Z-up
 * (the caller's streaming root applies the Z-up→Y-up rotation).
 */
export function buildVehicle(clump: RWClump, textures: Map<string, Texture>, options: VehicleOptions): Group {
  const root = new Group();
  root.name = 'RWVehicle';
  const worldCache = new Map<number, Matrix4>();

  let wheelGeometryIndex: null | number = null;

  for (const atomic of clump.atomics) {
    const frame = clump.frames[atomic.frameIndex];
    const name = frame?.name.toLowerCase() ?? '';
    const geometry = clump.geometries[atomic.geometryIndex];
    if (!geometry) {
      continue;
    }
    if (name === WHEEL_FRAME) {
      wheelGeometryIndex = atomic.geometryIndex; // placed separately at the dummies
      continue;
    }
    if (name.endsWith('_dam') || name.endsWith('_vlo')) {
      continue;
    }

    const mesh = new Mesh(
      buildGeometry(geometry),
      geometry.materials.map((m) => buildVehicleMaterial(m, geometry, textures, options)),
    );
    mesh.name = name || `atomic_${atomic.geometryIndex}`;
    mesh.applyMatrix4(worldMatrix(clump, atomic.frameIndex, worldCache));
    root.add(mesh);
  }

  if (wheelGeometryIndex !== null) {
    addWheels(root, clump, wheelGeometryIndex, textures, options, worldCache);
  }

  return root;
}

/** Instance the wheel geometry at each present `wheel_*_dummy` frame. */
function addWheels(
  root: Group,
  clump: RWClump,
  geometryIndex: number,
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): void {
  const wheel = clump.geometries[geometryIndex];
  const geometry = buildGeometry(wheel);
  const materials = wheel.materials.map((m) => buildVehicleMaterial(m, wheel, textures, options));

  clump.frames.forEach((frame, index) => {
    const placement = wheelPlacement(frame.name.toLowerCase());
    if (!placement) {
      return;
    }
    const scale = (placement.rear ? options.wheelScale[1] : options.wheelScale[0]) * WHEEL_SCALE_BOOST;
    const matrix = worldMatrix(clump, index, worldCache).clone();
    if (!placement.right) {
      // The wheel is modelled facing out on the right (+X) side; spin the left-side
      // copies 180° about the up axis so their outer face points outward too.
      matrix.multiply(new Matrix4().makeRotationZ(Math.PI));
    }
    matrix.scale(new Vector3(scale, scale, scale));

    const mesh = new Mesh(geometry, materials);
    mesh.name = frame.name;
    mesh.applyMatrix4(matrix);
    root.add(mesh);
  });
}

/** Like {@link buildMaterial}, but paint markers become the carcol colour (tinting the texture). */
function buildVehicleMaterial(
  rw: RWMaterial,
  geometry: RWGeometry,
  textures: Map<string, Texture>,
  options: VehicleOptions,
): MeshStandardMaterial {
  const material = buildMaterial(rw, geometry, textures);
  const paint = paintFor(rw.color, options);
  if (paint) {
    material.color.setRGB(paint[0] / 255, paint[1] / 255, paint[2] / 255);
  }

  // Glass/translucent parts encode their opacity in the material colour's alpha,
  // which the shared builder ignores for textured materials. Blend it properly and
  // skip depth writes so the glass doesn't paint a black panel over the parts behind it.
  if (rw.color[3] < 255) {
    material.transparent = true;
    material.opacity = rw.color[3] / 255;
    material.alphaTest = 0;
    material.depthWrite = false;
    material.side = DoubleSide;
  }

  return material;
}

/** Map a material colour to the paint it represents, or null if it is not a marker. */
function paintFor(
  color: readonly [number, number, number, number],
  options: VehicleOptions,
): [number, number, number] | null {
  if (color[0] === PRIMARY_MARKER[0] && color[1] === PRIMARY_MARKER[1] && color[2] === PRIMARY_MARKER[2]) {
    return options.primary;
  }
  if (color[0] === SECONDARY_MARKER[0] && color[1] === SECONDARY_MARKER[1] && color[2] === SECONDARY_MARKER[2]) {
    return options.secondary;
  }

  return null;
}

/** Match `wheel_{lf|rf|lb|rb}_dummy` → side flags, or null if not a wheel dummy. */
function wheelPlacement(frameName: string): null | { rear: boolean; right: boolean } {
  const match = /^wheel_(lf|rf|lb|rb)_dummy$/.exec(frameName);
  if (!match) {
    return null;
  }
  const [side, axle] = match[1];

  return { rear: axle === 'b', right: side === 'r' };
}

/** Compose a frame's world transform by walking its parent chain (cached). */
function worldMatrix(clump: RWClump, index: number, cache: Map<number, Matrix4>): Matrix4 {
  const cached = cache.get(index);
  if (cached) {
    return cached;
  }
  const frame = clump.frames[index];
  const local = frameMatrix(frame.rotation, frame.position);
  const world =
    frame.parentIndex >= 0 && frame.parentIndex !== index
      ? worldMatrix(clump, frame.parentIndex, cache).clone().multiply(local)
      : local;
  cache.set(index, world);

  return world;
}
