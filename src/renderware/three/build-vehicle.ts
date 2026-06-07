import type { MeshStandardMaterial, Object3D, Quaternion, Texture } from 'three';

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

/** A damageable body part: an `_ok`/`_dam` mesh pair under a detachable pivot. */
export interface BuiltPart {
  /** The damaged mesh (hidden until damaged). */
  dam: Object3D;
  /** Part name without the `_ok`/`_dam` suffix (e.g. `bonnet`, `door_lf`). */
  name: string;
  /** The undamaged mesh (shown initially). */
  ok: Object3D;
  /** Group holding the part (positioned in vehicle space); detached when the part falls off. */
  pivot: Group;
  /** Part centre in vehicle space `[x, y, z]` (for mapping a hit location to the part). */
  position: [number, number, number];
}

/** The renderable vehicle plus its addressable, animatable parts (the dummy rig). */
export interface BuiltVehicle {
  /** Swinging doors (pivot at the hinge). */
  doors: BuiltDoor[];
  /** Damageable panels/doors with `_ok`/`_dam` meshes (for the collision-damage system). */
  parts: BuiltPart[];
  root: Group;
  /** Seat dummy local transforms in vehicle space (null if absent). */
  seats: { backseat: Matrix4 | null; frontseat: Matrix4 | null };
  wheels: BuiltWheel[];
}

/** One placed wheel: the group a rig spins (about the axle) and steers (front, about up). */
export interface BuiltWheel {
  /** Wheel hub position in vehicle space `[x, y, z]` (the raycast-vehicle connection point). */
  connection: [number, number, number];
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

/** Shared inputs for building one body atomic (door / damageable panel / plain mesh). */
interface BodyBuild {
  clump: RWClump;
  /** Damaged geometry by part name (e.g. `bonnet` → bonnet_dam geometry), paired with `_ok`. */
  damGeometry: Map<string, RWGeometry>;
  options: VehicleOptions;
  root: Group;
  textures: Map<string, Texture>;
  worldCache: Map<number, Matrix4>;
}

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
  const build: BodyBuild = {
    clump,
    damGeometry: collectDamGeometry(clump),
    options,
    root,
    textures,
    worldCache: new Map(),
  };
  const doors: BuiltDoor[] = [];
  const parts: BuiltPart[] = [];

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
      continue; // `_dam` is paired with its `_ok`; `_vlo` is the low-detail LOD
    }
    const built = addBodyAtomic(build, atomic, frame, name, geometry);
    if (built.door) {
      doors.push(built.door);
    }
    if (built.part) {
      parts.push(built.part);
    }
  }

  const { worldCache } = build;
  const wheels =
    wheelGeometryIndex === null ? [] : addWheels(root, clump, wheelGeometryIndex, textures, options, worldCache);
  const seats = {
    backseat: seatMatrix(clump, 'ped_backseat', worldCache),
    frontseat: seatMatrix(clump, 'ped_frontseat', worldCache),
  };

  return { doors, parts, root, seats, wheels };
}

/** Build one body atomic: a swinging door, a damageable `_ok`/`_dam` panel, or a plain mesh. */
function addBodyAtomic(
  build: BodyBuild,
  atomic: RWClump['atomics'][number],
  frame: RWFrame | undefined,
  name: string,
  geometry: RWGeometry,
): { door?: BuiltDoor; part?: BuiltPart } {
  const { clump, damGeometry, options, root, textures, worldCache } = build;

  const doorSide = frame ? DOOR_RE.exec(name)?.[1] : undefined;
  if (doorSide && frame) {
    const built = addDoor(root, clump, geometry, frame, doorSide, damGeometry.get(`door_${doorSide}`), textures, options, worldCache); // eslint-disable-line prettier/prettier

    return { door: built.door, part: built.part ?? undefined };
  }

  const dam = name.endsWith('_ok') ? damGeometry.get(name.slice(0, -3)) : undefined;
  if (dam) {
    return { part: addPanel(root, clump, name.slice(0, -3), geometry, dam, atomic.frameIndex, textures, options, worldCache) }; // eslint-disable-line prettier/prettier
  }

  const mesh = vehicleMesh(geometry, textures, options);
  mesh.name = name || `atomic_${atomic.geometryIndex}`;
  mesh.applyMatrix4(worldMatrix(clump, atomic.frameIndex, worldCache));
  root.add(mesh);

  return {};
}

/**
 * Wrap a `door_*_ok` atomic (+ optional `_dam`) in a pivot at its hinge
 * (`door_*_dummy`) so the door can swing and be damaged. Meshes are hinge-relative;
 * rotating the pivot about its local Z (up) opens it. Returns the door rig + part.
 */
function addDoor(
  root: Group,
  clump: RWClump,
  okGeometry: RWGeometry,
  frame: RWFrame,
  side: string,
  damGeometry: RWGeometry | undefined,
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): { door: BuiltDoor; part: BuiltPart | null } {
  const pivot = new Group();
  pivot.name = `door_${side}`;
  pivot.applyMatrix4(frame.parentIndex >= 0 ? worldMatrix(clump, frame.parentIndex, worldCache) : new Matrix4());

  const local = frameMatrix(frame.rotation, frame.position); // door is hinge-relative
  const ok = vehicleMesh(okGeometry, textures, options);
  ok.name = `door_${side}_ok`;
  ok.applyMatrix4(local);
  pivot.add(ok);

  let part: BuiltPart | null = null;
  if (damGeometry) {
    const dam = vehicleMesh(damGeometry, textures, options);
    dam.name = `door_${side}_dam`;
    dam.applyMatrix4(local);
    dam.visible = false;
    pivot.add(dam);
    const position = new Vector3().setFromMatrixPosition(pivot.matrix);
    part = { dam, name: `door_${side}`, ok, pivot, position: [position.x, position.y, position.z] };
  }
  root.add(pivot);

  return { door: { closed: pivot.quaternion.clone(), pivot, side }, part };
}

/**
 * Build a damageable panel: its `_ok` (shown) and `_dam` (hidden) meshes under a
 * pivot placed at the part's world transform, so it can swap on damage and detach
 * (fall off) on a second hit. Returns the part handle.
 */
function addPanel(
  root: Group,
  clump: RWClump,
  name: string,
  okGeometry: RWGeometry,
  damGeometry: RWGeometry,
  frameIndex: number,
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): BuiltPart {
  const world = worldMatrix(clump, frameIndex, worldCache);
  const pivot = new Group();
  pivot.name = name;
  pivot.applyMatrix4(world);

  const ok = vehicleMesh(okGeometry, textures, options);
  ok.name = `${name}_ok`;
  const dam = vehicleMesh(damGeometry, textures, options);
  dam.name = `${name}_dam`;
  dam.visible = false;
  pivot.add(ok, dam);
  root.add(pivot);

  const position = new Vector3().setFromMatrixPosition(world);

  return { dam, name, ok, pivot, position: [position.x, position.y, position.z] };
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

    const world = worldMatrix(clump, index, worldCache);
    const pivot = new Group();
    pivot.name = frame.name;
    pivot.applyMatrix4(world); // dummy position + orientation

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
    const hub = new Vector3().setFromMatrixPosition(world);
    wheels.push({
      connection: [hub.x, hub.y, hub.z],
      front: !placement.rear,
      radius: baseRadius * scale,
      spinner,
    });
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

/** Index every `_dam` atomic's geometry by its part name (the prefix before `_dam`). */
function collectDamGeometry(clump: RWClump): Map<string, RWGeometry> {
  const damGeometry = new Map<string, RWGeometry>();
  for (const atomic of clump.atomics) {
    const name = clump.frames[atomic.frameIndex]?.name.toLowerCase() ?? '';
    const geometry = clump.geometries[atomic.geometryIndex];
    if (geometry && name.endsWith('_dam')) {
      damGeometry.set(name.slice(0, -4), geometry);
    }
  }

  return damGeometry;
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

/** A vehicle body mesh: geometry + painted/glass materials. */
function vehicleMesh(geometry: RWGeometry, textures: Map<string, Texture>, options: VehicleOptions): Mesh {
  return new Mesh(
    buildGeometry(geometry),
    geometry.materials.map((m) => buildVehicleMaterial(m, geometry, textures, options)),
  );
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
