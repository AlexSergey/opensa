import type { Quaternion, Texture } from 'three';
import type { MeshStandardMaterial } from 'three';

import { DoubleSide, Group, Matrix4, Mesh, Vector3 } from 'three';

import type { RWClump, RWFrame, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { buildGeometry, buildMaterial, frameMatrix } from './build-clump';

/** One door: the group rotated about its hinge (open = closed × rotation about up). */
export interface BuiltDoor {
  /** Closed-state hinge quaternion. */
  closed: Quaternion;
  /** Group rotated to swing the door (mesh is hinge-relative). */
  pivot: Group;
  /** 'lf' | 'rf' | 'lr' | 'rr'. */
  side: string;
}

/** The renderable vehicle plus its addressable, animatable parts (the dummy rig). */
export interface BuiltVehicle {
  /** Swinging doors (pivot at the hinge). */
  doors: BuiltDoor[];
  root: Group;
  /** Seat dummy local transforms in vehicle space (null if absent). */
  seats: { backseat: Matrix4 | null; frontseat: Matrix4 | null };
  wheels: BuiltWheel[];
}

/** One placed wheel: the group a rig spins (about the axle) and steers (front, about up). */
export interface BuiltWheel {
  /** Front wheels steer; all wheels spin. */
  front: boolean;
  /** Wheel radius in world units (roll = distance / radius). */
  radius: number;
  /** Group rotated by the rig — its mesh is centred so spin/steer pivot correctly. */
  spinner: Group;
}

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

/** Door body atomics — `door_{lf|rf|lr|rr}_ok` — wrapped in a hinge pivot so they swing. */
const DOOR_RE = /^door_(lf|rf|lr|rr)_ok$/;

/** Wheels read a touch small from the vehicles.ide scale alone; nudge them up in-engine. */
const WHEEL_SCALE_BOOST = 1.25;

/**
 * Build a renderable vehicle from its DFF clump. Renders the body (chassis +
 * each `*_ok` component atomic, placed by its frame's **world** transform),
 * skipping `*_dam` (damaged) and `*_vlo` (LOD) parts and the bare `wheel`
 * atomic. The wheel is instanced at the four `wheel_*_dummy` frames, scaled per
 * front/rear and mirrored on the right side. Paint markers in material colours
 * are replaced by the carcol primary/secondary. Result stays in native Z-up
 * (the caller's streaming root applies the Z-up→Y-up rotation). Wheels are
 * wrapped in pivot/spinner groups so a {@link BuiltWheel} rig can spin and steer
 * them.
 */
export function buildVehicle(clump: RWClump, textures: Map<string, Texture>, options: VehicleOptions): BuiltVehicle {
  const root = new Group();
  root.name = 'RWVehicle';
  const worldCache = new Map<number, Matrix4>();
  const doors: BuiltDoor[] = [];

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

    const doorSide = frame ? DOOR_RE.exec(name)?.[1] : undefined;
    if (doorSide && frame) {
      doors.push(addDoor(root, clump, geometry, frame, doorSide, textures, options, worldCache));
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

  const wheels =
    wheelGeometryIndex === null ? [] : addWheels(root, clump, wheelGeometryIndex, textures, options, worldCache);
  const seats = {
    backseat: seatMatrix(clump, 'ped_backseat', worldCache),
    frontseat: seatMatrix(clump, 'ped_frontseat', worldCache),
  };

  return { doors, root, seats, wheels };
}

/**
 * Wrap a `door_*_ok` atomic in a pivot at its hinge (`door_*_dummy`) so the door
 * can swing. The mesh is placed hinge-relative; rotating the pivot about its
 * local Z (up) opens it. Returns the door's rig handle.
 */
function addDoor(
  root: Group,
  clump: RWClump,
  geometry: RWGeometry,
  frame: RWFrame,
  side: string,
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): BuiltDoor {
  const pivot = new Group();
  pivot.name = `door_${side}`;
  pivot.applyMatrix4(frame.parentIndex >= 0 ? worldMatrix(clump, frame.parentIndex, worldCache) : new Matrix4());

  const mesh = new Mesh(
    buildGeometry(geometry),
    geometry.materials.map((m) => buildVehicleMaterial(m, geometry, textures, options)),
  );
  mesh.name = `door_${side}_ok`;
  mesh.applyMatrix4(frameMatrix(frame.rotation, frame.position)); // door is hinge-relative
  pivot.add(mesh);
  root.add(pivot);

  return { closed: pivot.quaternion.clone(), pivot, side };
}

/**
 * Instance the wheel geometry at each `wheel_*_dummy` frame. Each wheel is a
 * `pivot` (positioned/oriented like the dummy) → `spinner` (rotated by the rig) →
 * `mesh` (mirrored on the left, scaled, centred on the pivot). Returns the rig
 * handles. The spin axis is the pivot's local X (axle), steer is its Z (up).
 */
function addWheels(
  root: Group,
  clump: RWClump,
  geometryIndex: number,
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): BuiltWheel[] {
  const wheelGeometry = clump.geometries[geometryIndex];
  const geometry = buildGeometry(wheelGeometry);
  const materials = wheelGeometry.materials.map((m) => buildVehicleMaterial(m, wheelGeometry, textures, options));
  const baseRadius = geometry.boundingSphere?.radius ?? 0.5;
  const wheels: BuiltWheel[] = [];

  clump.frames.forEach((frame, index) => {
    const placement = wheelPlacement(frame.name.toLowerCase());
    if (!placement) {
      return;
    }
    const scale = (placement.rear ? options.wheelScale[1] : options.wheelScale[0]) * WHEEL_SCALE_BOOST;

    const pivot = new Group();
    pivot.name = frame.name;
    pivot.applyMatrix4(worldMatrix(clump, index, worldCache)); // dummy position + orientation

    const spinner = new Group();
    spinner.name = `${frame.name}_spin`;
    pivot.add(spinner);

    // Mesh centred on the pivot so spin/steer rotate about the axle, not an offset.
    const local = new Matrix4();
    if (!placement.right) {
      // The wheel is modelled facing out on the right (+X) side; mirror the left copies.
      local.multiply(new Matrix4().makeRotationZ(Math.PI));
    }
    local.scale(new Vector3(scale, scale, scale));
    const mesh = new Mesh(geometry, materials);
    mesh.name = `${frame.name}_mesh`;
    mesh.applyMatrix4(local);
    spinner.add(mesh);

    root.add(pivot);
    wheels.push({ front: !placement.rear, radius: baseRadius * scale, spinner });
  });

  return wheels;
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

/** The world (vehicle-space) transform of a seat dummy frame, or null if absent. */
function seatMatrix(clump: RWClump, name: string, worldCache: Map<number, Matrix4>): Matrix4 | null {
  const index = clump.frames.findIndex((f) => f.name.toLowerCase() === name);

  return index >= 0 ? worldMatrix(clump, index, worldCache).clone() : null;
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
