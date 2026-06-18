import type { BufferGeometry, MeshStandardMaterial, Object3D, Quaternion, Side, Texture } from 'three';

import { BackSide, DoubleSide, FrontSide, Group, Matrix4, Mesh, Vector3 } from 'three';

import type { RWClump, RWFrame, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { buildGeometry, buildMaterial, frameMatrix } from './build-clump';
import { applyNightFill } from './night-fill';

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
  /** Low-detail LOD: the hidden `*_vlo` meshes grouped under `root` (shown at distance), or null. */
  lod: null | Object3D;
  /** Damageable panels/doors with `_ok`/`_dam` meshes (for the collision-damage system). */
  parts: BuiltPart[];
  /** Env-map-reflective materials (tagged `userData.reflection`) for the vehicle-reflection plugin. */
  reflectiveMaterials: MeshStandardMaterial[];
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
  /** 4th-colour paint RGB, replaces the `(255,60,0)` marker (falls back to secondary). */
  quaternary?: [number, number, number];
  /** Secondary paint RGB (0-255), replaces the `(255,0,175)` marker. */
  secondary: [number, number, number];
  /** 3rd-colour paint RGB, replaces the `(255,175,0)` marker (falls back to primary). */
  tertiary?: [number, number, number];
  /** Wheel scale `[front, rear]` from vehicles.ide. */
  wheelScale: [number, number];
}

/** Material marker colours the carcol paint replaces — SA's editable material colours 1-4 (the standard
 *  Kam's/ZModeler magic colours): 1 green, 2 magenta, 3 cyan, 4 yellow. NOTE: (255,175,0)/(255,60,0) are
 *  NOT paint markers — they are per-lamp ids on the `vehiclelights` atlas; verified across admiral, bobcat
 *  and camper, all of whose real 3rd-colour paint is cyan (those two colours appear only on lamps). */
const PRIMARY_MARKER: [number, number, number] = [60, 255, 0];
const SECONDARY_MARKER: [number, number, number] = [255, 0, 175];
const TERTIARY_MARKER: [number, number, number] = [0, 255, 255];
const QUATERNARY_MARKER: [number, number, number] = [255, 255, 0];

/** The single wheel atomic, instanced at each `wheel_*_dummy`. */
const WHEEL_FRAME = 'wheel';

/** Per-corner wheel atomics — `wheel_{l|r}{f|m|b}` — each its own mesh, SA's "different front/rear wheels"
 *  convention (as opposed to the single shared {@link WHEEL_FRAME} atomic instanced at the dummies). The
 *  middle axle (`m`) is for 3-axle trucks (e.g. petro). */
const WHEEL_CORNER_RE = /^wheel_(lf|rf|lm|rm|lb|rb)$/;

/** Door body atomics — `door_{lf|rf|lr|rr}_ok` — wrapped in a hinge pivot so they swing. */
const DOOR_RE = /^door_(lf|rf|lr|rr)_ok$/;

/** Wheels read a touch small from the vehicles.ide scale alone; nudge them up in-engine. */
const WHEEL_SCALE_BOOST = 1.25;

/** Glass renders in two passes (after opaque): back faces first, then front faces. */
const GLASS_BACK_ORDER = 1;
const GLASS_FRONT_ORDER = 2;

/** Max distance (m) a lamp material may sit from a head/tail dummy to count as that light. Tight: the real
 *  head/tail lamps sit right on the dummy; this excludes the grille/badge/mirror/indicator/reverse lamps that
 *  share the `vehiclelights` atlas but are offset from the dummy. */
const LAMP_DUMMY_RADIUS = 0.5;

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

/** A per-corner wheel atomic and its axle/side flags (the {@link WHEEL_CORNER_RE} convention). */
interface CornerWheel {
  atomic: RWClump['atomics'][number];
  /** Middle + back axles (everything but the front) — they don't steer. */
  rear: boolean;
  /** Right side (`r*`) — left copies are mirrored so they face outward. */
  right: boolean;
}

/**
 * Build a renderable vehicle from its DFF clump. Renders the body (chassis +
 * each `*_ok` component atomic, placed by its frame's **world** transform),
 * skipping `*_dam` (damaged) and `*_vlo` (LOD) parts and the wheel atomics.
 * Wheels follow one of SA's two conventions: a single shared `wheel` atomic
 * instanced at the four `wheel_*_dummy` frames (scaled per front/rear, mirrored
 * on the right), or per-corner `wheel_{lf|rf|lb|rb}` atomics placed at their own
 * frames (different front/rear wheels). A lone corner atomic with no shared
 * `wheel` but real dummies is treated as a mis-named shared wheel (see
 * {@link buildWheels}). Paint markers in material colours
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
  const lod = new Group();
  lod.name = 'lod';
  lod.visible = false; // shown only at distance by the LOD system

  let wheelGeometryIndex: null | number = null;
  const cornerWheels: CornerWheel[] = [];

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
    const corner = WHEEL_CORNER_RE.exec(name)?.[1];
    if (corner) {
      // per-corner wheel — placed by the rig, not the body. Middle (`m`) + back (`b`) axles don't steer.
      cornerWheels.push({ atomic, rear: corner[1] !== 'f', right: corner[0] === 'r' });
      continue;
    }
    if (name.endsWith('_vlo')) {
      addLodAtomic(build, lod, atomic, name);
      continue; // low-detail LOD — hidden until far
    }
    if (name.endsWith('_dam')) {
      continue; // paired with its `_ok` (see collectDamGeometry)
    }
    const built = addBodyAtomic(build, atomic, frame, name, geometry);
    if (built.door) {
      doors.push(built.door);
    }
    if (built.part) {
      parts.push(built.part);
    }
  }
  if (lod.children.length > 0) {
    root.add(lod);
  }

  const { worldCache } = build;
  const wheels = buildWheels(root, clump, { cornerWheels, wheelGeometryIndex }, textures, options, worldCache);
  const seats = {
    backseat: seatMatrix(clump, 'ped_backseat', worldCache),
    frontseat: seatMatrix(clump, 'ped_frontseat', worldCache),
  };
  // The `headlights`/`taillights` dummies each sit at one lamp; SA mirrors them ±X to both sides. Keep `|x|`
  // (the lamp's side offset), front/back (Y) and height (Z). These are the authoritative lamp positions — the
  // headlight system glows only the lamp materials sitting near them (see tagLamps), so mirrors/indicators/
  // reverse lights (offset from the dummies) stay dark.
  const headlights = seatMatrix(clump, 'headlights', worldCache);
  const headDummy = headlights
    ? ([Math.abs(headlights.elements[12]), headlights.elements[13], headlights.elements[14]] as [
        number,
        number,
        number,
      ])
    : null;
  const taillights = seatMatrix(clump, 'taillights', worldCache);
  const tailDummy = taillights
    ? ([Math.abs(taillights.elements[12]), taillights.elements[13], taillights.elements[14]] as [
        number,
        number,
        number,
      ])
    : null;
  root.userData.headlightDummy = headDummy;
  root.userData.taillightDummy = tailDummy;
  tagLamps(root, headDummy, tailDummy);

  root.traverse((object) => {
    object.castShadow = true; // body/wheels/parts cast + receive sun shadows
    object.receiveShadow = true;
  });
  tagHeadlights(root, textures);

  return {
    doors,
    lod: lod.children.length > 0 ? lod : null,
    parts,
    reflectiveMaterials: collectReflectiveMaterials(root),
    root,
    seats,
    wheels,
  };
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
    const built = addDoor(
      root,
      clump,
      geometry,
      frame,
      doorSide,
      damGeometry.get(`door_${doorSide}`),
      textures,
      options,
      worldCache,
    );

    return { door: built.door, part: built.part ?? undefined };
  }

  const dam = name.endsWith('_ok') ? damGeometry.get(name.slice(0, -3)) : undefined;
  if (dam) {
    return {
      part: addPanel(root, clump, name.slice(0, -3), geometry, dam, atomic.frameIndex, textures, options, worldCache),
    };
  }

  const mesh = vehicleMesh(geometry, textures, options);
  mesh.name = name || `atomic_${atomic.geometryIndex}`;
  mesh.applyMatrix4(worldMatrix(clump, atomic.frameIndex, worldCache));
  root.add(mesh);

  return {};
}

/**
 * Place each per-corner wheel atomic (`wheel_{lf|rf|lb|rb}`) on its own frame — SA's "different
 * front/rear wheels" convention, where the wheels are modelled in place rather than instancing a
 * single shared {@link WHEEL_FRAME} atomic at the dummies. Each keeps the same pivot → spinner →
 * mesh rig as {@link addWheels} so it spins (about the axle) and steers (front, about up). The
 * geometry is reused +X-facing across corners (side comes from the frame translation), so the left
 * copies are mirrored exactly like the shared wheel; no wheel-scale (authored at size). Returns the
 * rig handles (empty when the clump has no per-corner wheels).
 */
function addCornerWheels(
  root: Group,
  clump: RWClump,
  corners: readonly CornerWheel[],
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): BuiltWheel[] {
  const wheels: BuiltWheel[] = [];

  for (const { atomic, rear, right } of corners) {
    const rwGeometry = clump.geometries[atomic.geometryIndex];
    const geometry = buildGeometry(rwGeometry);
    const materials = rwGeometry.materials.map((m, i) => buildVehicleMaterial(m, rwGeometry, textures, options, i));
    const name = clump.frames[atomic.frameIndex]?.name ?? `wheel_${rear ? 'b' : 'f'}`;

    const world = worldMatrix(clump, atomic.frameIndex, worldCache);
    const pivot = new Group();
    pivot.name = name;
    pivot.applyMatrix4(world); // the wheel's own frame is the hub (geometry centred on it)

    const spinner = new Group();
    spinner.name = `${name}_spin`;
    pivot.add(spinner);

    // The wheel is modelled facing out on the right (+X); mirror the left copies so they don't face
    // inward. Mesh centred on the pivot so spin/steer rotate about the axle, not an offset.
    const mesh = new Mesh(geometry, materials);
    mesh.name = `${name}_mesh`;
    if (!right) {
      mesh.applyMatrix4(new Matrix4().makeRotationZ(Math.PI));
    }
    spinner.add(mesh);
    root.add(pivot);

    const hub = new Vector3().setFromMatrixPosition(world);
    wheels.push({
      connection: [hub.x, hub.y, hub.z],
      front: !rear,
      radius: geometry.boundingSphere?.radius ?? 0.5,
      spinner,
    });
  }

  return wheels;
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

/** Add one `*_vlo` atomic to the (hidden) LOD group, placed by its frame's world transform. */
function addLodAtomic(build: BodyBuild, lod: Group, atomic: RWClump['atomics'][number], name: string): void {
  const geometry = build.clump.geometries[atomic.geometryIndex];
  const mesh = vehicleMesh(geometry, build.textures, build.options);
  mesh.name = name;
  mesh.applyMatrix4(worldMatrix(build.clump, atomic.frameIndex, build.worldCache));
  lod.add(mesh);
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
  const materials = wheelGeometry.materials.map((m, i) => buildVehicleMaterial(m, wheelGeometry, textures, options, i));
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
  materialIndex: number,
): MeshStandardMaterial {
  const material = buildMaterial(rw, geometry, textures);
  const isLight = (rw.texture?.name.toLowerCase() ?? '').startsWith('vehiclelights');
  if (isLight) {
    // Lamp materials (`vehiclelights*`) carry SA per-lamp "magic" marker colours that ALSO collide with carcol
    // markers — never render them (else garish flat green/red patches): show the lamp texture untinted. The
    // marker colour is a per-lamp id (NOT front/rear/colour), so stash the lamp's centroid and let `tagLamps`
    // decide head/tail by which dummy it sits at (mirrors/indicators/reverse, offset from a dummy, stay dark).
    material.color.setHex(0xffffff);
    const centroid = lightCentroid(geometry, materialIndex);
    if (centroid) {
      material.userData.lightCentroid = centroid;
    }
  } else {
    const paint = paintFor(rw.color, options);
    if (paint) {
      // setHex (sRGB), matching buildMaterial — setRGB would treat it as linear and wash the paint out.
      material.color.setHex((paint[0] << 16) | (paint[1] << 8) | paint[2]);
    } else if (material.map) {
      // RenderWare modulates the texture by the material colour. The shared builder forces white for
      // textured materials (fine for map geometry), but vehicles rely on it: interiors tint a light
      // fabric/leather texture with dark grey material colours. Restore the modulate.
      material.color.setHex((rw.color[0] << 16) | (rw.color[1] << 8) | rw.color[2]);
    }
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
  } else if (!isLight) {
    applyNightFill(material); // plan 034: self-illuminate the car body at night (skip glass + lights)
  }

  return material;
}

function buildWheels(
  root: Group,
  clump: RWClump,
  source: { cornerWheels: readonly CornerWheel[]; wheelGeometryIndex: null | number },
  textures: Map<string, Texture>,
  options: VehicleOptions,
  worldCache: Map<number, Matrix4>,
): BuiltWheel[] {
  // A lone corner atomic with no shared `wheel`, alongside real `wheel_*_dummy` frames, is a mis-named
  // shared wheel (some mods, e.g. comet, ship only `wheel_rf` expecting it instanced at all four dummies).
  // Treat its geometry as the shared wheel. Genuine per-corner sets (≥2 corners) stay on addCornerWheels.
  if (source.wheelGeometryIndex === null && source.cornerWheels.length === 1 && hasWheelDummies(clump)) {
    return addWheels(root, clump, source.cornerWheels[0].atomic.geometryIndex, textures, options, worldCache);
  }
  if (source.cornerWheels.length > 0) {
    return addCornerWheels(root, clump, source.cornerWheels, textures, options, worldCache);
  }
  if (source.wheelGeometryIndex !== null) {
    return addWheels(root, clump, source.wheelGeometryIndex, textures, options, worldCache);
  }

  return [];
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

function collectReflectiveMaterials(root: Object3D): MeshStandardMaterial[] {
  const found = new Set<MeshStandardMaterial>();
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material.userData.reflection) {
        found.add(material as MeshStandardMaterial);
      }
    }
  });

  return [...found];
}

/** Distance from a lamp centroid to a dummy, taking the nearer of the dummy's ±X mirror (SA mirrors lamps). */
function dummyDistance(c: readonly number[], dummy: readonly number[]): number {
  const dy = c[1] - dummy[1];
  const dz = c[2] - dummy[2];

  return Math.min(Math.hypot(c[0] - dummy[0], dy, dz), Math.hypot(c[0] + dummy[0], dy, dz));
}

/** One glass render pass: the glass groups drawn single-sided (cloned materials) at a fixed order. */
function glassPass(
  geometry: BufferGeometry,
  materials: MeshStandardMaterial[],
  glass: Set<number>,
  side: Side,
  renderOrder: number,
): Mesh {
  const passMaterials = materials.map((material, index) => {
    if (!glass.has(index)) {
      return material; // slot not referenced by the glass geometry's groups
    }
    const clone = material.clone();
    clone.side = side;

    return clone;
  });
  const mesh = new Mesh(geometry, passMaterials);
  mesh.renderOrder = renderOrder;

  return mesh;
}

/**
 * Pick the wheel rig: per-corner atomics win when present (distinct per-position meshes, any axle
 * count — some models also keep a stray shared `wheel` atomic for compatibility, which we then
 * ignore); otherwise instance the single shared `wheel` atomic at the dummies. [] when neither.
 */
/** True if the clump has any `wheel_*_dummy` frame (the shared-wheel instancing targets). */
function hasWheelDummies(clump: RWClump): boolean {
  return clump.frames.some((frame) => wheelPlacement(frame.name.toLowerCase()) !== null);
}

/** Which light a lamp centroid belongs to: the nearer of the head/tail dummy within {@link LAMP_DUMMY_RADIUS},
 *  or null if it's too far from both (mirror / indicator / reverse / chrome). Falls back to the Y sign when the
 *  model has no light dummies. */
function lampSide(
  c: readonly number[],
  head: null | readonly number[],
  tail: null | readonly number[],
): 'head' | 'tail' | null {
  const dHead = head ? dummyDistance(c, head) : Infinity;
  const dTail = tail ? dummyDistance(c, tail) : Infinity;
  if (dHead === Infinity && dTail === Infinity) {
    return c[1] >= 0 ? 'head' : 'tail';
  }
  if (Math.min(dHead, dTail) > LAMP_DUMMY_RADIUS) {
    return null;
  }

  return dHead <= dTail ? 'head' : 'tail';
}

/** Geometry-local centroid (vehicle space, frames here are ~identity) of the vertices a material's triangles
 *  use, or null if it has none. Used to match a lamp material against the headlight/taillight dummy. */
function lightCentroid(geometry: RWGeometry, materialIndex: number): [number, number, number] | null {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;
  for (const triangle of geometry.triangles) {
    if (triangle.materialIndex !== materialIndex) {
      continue;
    }
    for (const vertex of [triangle.a, triangle.b, triangle.c]) {
      x += geometry.positions[vertex * 3];
      y += geometry.positions[vertex * 3 + 1];
      z += geometry.positions[vertex * 3 + 2];
      count += 1;
    }
  }

  return count === 0 ? null : [x / count, y / count, z / count];
}

/** Map a material colour to the paint it represents, or null if it is not a marker. */
function paintFor(
  color: readonly [number, number, number, number],
  options: VehicleOptions,
): [number, number, number] | null {
  // The four GTA SA carcol paint markers, in order; 3rd/4th fall back to 1st/2nd if not supplied.
  const slots: { marker: [number, number, number]; pick: () => [number, number, number] }[] = [
    { marker: PRIMARY_MARKER, pick: () => options.primary },
    { marker: SECONDARY_MARKER, pick: () => options.secondary },
    { marker: TERTIARY_MARKER, pick: () => options.tertiary ?? options.primary },
    { marker: QUATERNARY_MARKER, pick: () => options.quaternary ?? options.secondary },
  ];
  for (const { marker, pick } of slots) {
    if (color[0] === marker[0] && color[1] === marker[1] && color[2] === marker[2]) {
      return pick();
    }
  }

  return null;
}

/** The world (vehicle-space) transform of a seat dummy frame, or null if absent. */
function seatMatrix(clump: RWClump, name: string, worldCache: Map<number, Matrix4>): Matrix4 | null {
  const index = clump.frames.findIndex((f) => f.name.toLowerCase() === name);

  return index >= 0 ? worldMatrix(clump, index, worldCache).clone() : null;
}

/** Gather the vehicle's env-map-reflective materials (tagged in `buildMaterial`), deduped. */
/**
 * Tag the front-light materials (those using the shared `vehiclelights128` texture) with their day/night
 * maps on `userData` so the headlight system can swap them to `vehiclelightson128` (same UVs, the "lights on"
 * variant) when the car drives at night. No-op if the car uses neither texture.
 */
function tagHeadlights(root: Object3D, textures: Map<string, Texture>): void {
  const lightsOn = textures.get('vehiclelightson128');
  if (!lightsOn) {
    return;
  }
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      const map = (material as MeshStandardMaterial).map;
      if (map && map.name.toLowerCase() === 'vehiclelights128' && !material.userData.lightsOnMap) {
        material.userData.lightsOffMap = map;
        material.userData.lightsOnMap = lightsOn;
      }
    }
  });
}

/**
 * Tag each candidate lamp material (those with a stashed `lightCentroid`) with `userData.lightType` by which
 * dummy it sits nearest — so the headlight system glows only real head/tail lamps, not mirrors/indicators/
 * reverse lights (which are offset from the dummies and left untagged).
 */
function tagLamps(root: Object3D, head: null | readonly number[], tail: null | readonly number[]): void {
  root.traverse((object) => {
    const mesh = object as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const centroid = material.userData.lightCentroid as readonly number[] | undefined;
      if (!centroid) {
        continue;
      }
      const type = lampSide(centroid, head, tail);
      if (type) {
        material.userData.lightType = type;
      }
    }
  });
}

/** A vehicle body mesh: geometry + painted/glass materials. */
/**
 * A vehicle body node. With no glass it's a plain multi-material `Mesh`; when an
 * atomic has translucent (glass) materials those triangles are split into their
 * own geometry rendered in **two single-sided passes** (back faces, then front) so
 * the windows don't vanish at angles — the RenderWare single-pass culled/mis-sorted
 * alpha bug (the SilentPatch / SkyGFX two-sided two-pass fix). Returns one node so
 * callers (panels/doors/`_vlo`/damage) keep treating it as a single `Object3D`.
 */
function vehicleMesh(geometry: RWGeometry, textures: Map<string, Texture>, options: VehicleOptions): Object3D {
  const materials = geometry.materials.map((m, i) => buildVehicleMaterial(m, geometry, textures, options, i));
  const glass = new Set(materials.flatMap((material, index) => (material.transparent ? [index] : [])));
  if (glass.size === 0) {
    return new Mesh(buildGeometry(geometry), materials);
  }

  const group = new Group();
  const opaque = withTriangles(geometry, (index) => !glass.has(index));
  if (opaque.triangles.length > 0) {
    group.add(new Mesh(buildGeometry(opaque), materials));
  }
  const glassGeometry = buildGeometry(withTriangles(geometry, (index) => glass.has(index)));
  group.add(glassPass(glassGeometry, materials, glass, BackSide, GLASS_BACK_ORDER));
  group.add(glassPass(glassGeometry, materials, glass, FrontSide, GLASS_FRONT_ORDER));

  return group;
}

/** Match `wheel_{l|r}{f|m|b}_dummy` → side flags, or null if not a wheel dummy. The middle axle (`m`) is
 *  for 3-axle trucks; only the front axle steers, so middle + back both count as rear. */
function wheelPlacement(frameName: string): null | { rear: boolean; right: boolean } {
  const match = /^wheel_(lf|rf|lm|rm|lb|rb)_dummy$/.exec(frameName);
  if (!match) {
    return null;
  }
  const [side, axle] = match[1];

  return { rear: axle !== 'f', right: side === 'r' };
}

/** A copy of `rw` keeping only triangles whose material index passes `keep` (other arrays shared). */
function withTriangles(rw: RWGeometry, keep: (materialIndex: number) => boolean): RWGeometry {
  return { ...rw, triangles: rw.triangles.filter((triangle) => keep(triangle.materialIndex)) };
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
