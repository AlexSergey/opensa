import type { Mesh, MeshStandardMaterial } from 'three';

import { existsSync, readFileSync } from 'node:fs';
import { BackSide, FrontSide, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildVehicle, type VehicleOptions } from './build-vehicle';

const OPTIONS: VehicleOptions = {
  primary: [255, 0, 0],
  quaternary: [44, 55, 66],
  secondary: [0, 0, 255],
  tertiary: [11, 22, 33],
  wheelScale: [0.5, 0.25],
};

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

function triangleGeometry(materials: RWMaterial[]): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS,
    lights: [],
    materials,
    nightColors: null,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** Body geometry: primary + secondary paint markers, a plain material, and a glass material (used). */
const bodyGeometry: RWGeometry = {
  ...triangleGeometry([
    material({ color: [60, 255, 0, 255] }), // primary marker
    material({ color: [255, 0, 175, 255] }), // secondary marker
    material({ color: [10, 20, 30, 255] }), // plain
    material({ color: [255, 255, 255, 128], texture: { maskName: '', name: 'glass' } }), // translucent glass
    material({ color: [255, 175, 0, 255] }), // tertiary (3rd-colour) marker
    material({ color: [50, 50, 50, 255], texture: { maskName: '', name: 'interior' } }), // dark textured (interior)
  ]),
  triangles: [
    { a: 0, b: 1, c: 2, materialIndex: 0 }, // opaque
    { a: 0, b: 1, c: 2, materialIndex: 3 }, // glass
    { a: 0, b: 1, c: 2, materialIndex: 4 }, // tertiary
    { a: 0, b: 1, c: 2, materialIndex: 5 }, // interior
  ],
};
const wheelGeometry = triangleGeometry([material({ color: [40, 40, 40, 255] })]);

/** Materials of the `chassis` part's `_ok` mesh (full array — indices align with the geometry). */
function bodyMaterials(vehicle: ReturnType<typeof buildVehicle>): MeshStandardMaterial[] {
  return chassisOpaque(vehicle).material as MeshStandardMaterial[];
}

/** The `chassis` part's `_ok` opaque mesh (glass is split into its own two-pass sub-mesh). */
function chassisOpaque(vehicle: ReturnType<typeof buildVehicle>): Mesh {
  const ok = vehicle.parts.find((p) => p.name === 'chassis')?.ok as unknown as Mesh;

  return (ok.children[0] ?? ok) as Mesh;
}

function meshByName(vehicle: ReturnType<typeof buildVehicle>, name: string): Mesh {
  return vehicle.root.children.find((child) => child.name === name) as Mesh;
}

function vehicleClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [
      { frameIndex: 1, geometryIndex: 0 }, // chassis_ok
      { frameIndex: 2, geometryIndex: 0 }, // chassis_dam  (skipped)
      { frameIndex: 3, geometryIndex: 0 }, // chassis_vlo  (skipped)
      { frameIndex: 4, geometryIndex: 1 }, // wheel        (instanced)
      { frameIndex: 10, geometryIndex: 0 }, // door_lf_ok  (hinge pivot)
      { frameIndex: 11, geometryIndex: 0 }, // door_lf_dam (skipped)
    ],
    frames: [
      { name: 'chassis', parentIndex: -1, position: [0, 0, 0], rotation: id },
      { name: 'chassis_ok', parentIndex: 0, position: [0, 0, 1], rotation: id },
      { name: 'chassis_dam', parentIndex: 0, position: [0, 0, 0], rotation: id },
      { name: 'chassis_vlo', parentIndex: 0, position: [0, 0, 0], rotation: id },
      { name: 'wheel', parentIndex: 0, position: [0, 0, 0], rotation: id },
      { name: 'wheel_lf_dummy', parentIndex: 0, position: [1, 1, 0], rotation: id },
      { name: 'wheel_rf_dummy', parentIndex: 0, position: [-1, 1, 0], rotation: id },
      { name: 'wheel_lb_dummy', parentIndex: 0, position: [1, -1, 0], rotation: id },
      { name: 'wheel_rb_dummy', parentIndex: 0, position: [-1, -1, 0], rotation: id },
      { name: 'door_lf_dummy', parentIndex: 0, position: [1, 2, 0], rotation: id }, // hinge
      { name: 'door_lf_ok', parentIndex: 9, position: [0, 0, 0], rotation: id },
      { name: 'door_lf_dam', parentIndex: 9, position: [0, 0, 0], rotation: id },
      { name: 'ped_frontseat', parentIndex: 0, position: [0.5, 0, 0.2], rotation: id },
      { name: 'headlights', parentIndex: 0, position: [0.8, 2, 0.5], rotation: id }, // one front lamp
      { name: 'taillights', parentIndex: 0, position: [-0.7, -2, 0.4], rotation: id }, // one rear lamp (−X)
    ],
    geometries: [bodyGeometry, wheelGeometry],
  };
}

/** The scaled wheel mesh nested under its pivot → spinner. */
function wheelMesh(vehicle: ReturnType<typeof buildVehicle>, dummy: string): Mesh {
  return meshByName(vehicle, dummy).children[0].children[0] as Mesh;
}

describe('buildVehicle', () => {
  describe('negative cases', () => {
    it('does not render the damaged atom or the raw vlo as a top-level body mesh', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const names = group.root.children.map((child) => child.name);
      expect(names).not.toContain('chassis_dam');
      expect(names).not.toContain('chassis_vlo'); // the vlo lives inside the `lod` group, not at root
    });

    it('does not render the bare wheel atomic as its own mesh', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(group.root.children.map((child) => child.name)).not.toContain('wheel');
    });

    it('exposes only the undamaged door (the _dam variant is skipped)', () => {
      const { doors } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(doors).toHaveLength(1);
      expect(doors[0].side).toBe('lf');
    });
  });

  describe('positive cases', () => {
    it('renders the body and instances the wheel at the four dummies', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const names = group.root.children.map((child) => child.name).sort();
      expect(names).toEqual([
        'chassis', // _ok/_dam panel wrapped in a pivot
        'door_lf',
        'lod', // hidden low-detail group
        'wheel_lb_dummy',
        'wheel_lf_dummy',
        'wheel_rb_dummy',
        'wheel_rf_dummy',
      ]);
    });

    it('extracts the headlight/taillight lamp dummies, keeping |x| so SA can mirror them ±X', () => {
      const { root } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(root.userData.headlightDummy).toEqual([0.8, 2, 0.5]);
      expect(root.userData.taillightDummy).toEqual([0.7, -2, 0.4]); // |−0.7| side offset, rear (−Y)
    });

    it('untints lamp materials and tags head/tail by POSITION (front +Y = head, rear −Y = tail)', () => {
      const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const lights: RWGeometry = {
        ...triangleGeometry([
          material({ color: [0, 255, 200, 255], texture: { maskName: '', name: 'vehiclelights128' } }), // front lamp
          material({ color: [255, 60, 0, 255], texture: { maskName: '', name: 'vehiclelights128' } }), // rear lamp
        ]),
        // verts 0-2 at +Y (front), 3-5 at −Y (rear); the marker colour is a per-lamp id, not head/tail.
        positions: new Float32Array([0, 5, 0, 1, 5, 0, 0, 5, 1, 0, -5, 0, 1, -5, 0, 0, -5, 1]),
        triangles: [
          { a: 0, b: 1, c: 2, materialIndex: 0 },
          { a: 3, b: 4, c: 5, materialIndex: 1 },
        ],
      };
      const clump: RWClump = {
        atomics: [{ frameIndex: 1, geometryIndex: 0 }],
        frames: [
          { name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: id },
          { name: 'model_lights', parentIndex: 0, position: [0, 0, 0], rotation: id },
        ],
        geometries: [lights],
      };
      const mats = (buildVehicle(clump, new Map(), OPTIONS).root.children[0] as Mesh)
        .material as MeshStandardMaterial[];
      expect(mats.map((m) => m.color.getHex())).toEqual([0xffffff, 0xffffff]); // untinted (marker not rendered)
      expect(mats.map((m) => m.userData.lightType as string)).toEqual(['head', 'tail']); // by position, not colour
    });

    it('glows only lamps near a head/tail dummy — mirrors/offset lamps stay untagged', () => {
      const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];
      const lights: RWGeometry = {
        ...triangleGeometry([
          material({ color: [0, 255, 200, 255], texture: { maskName: '', name: 'vehiclelights128' } }), // at headlights
          material({ color: [185, 255, 0, 255], texture: { maskName: '', name: 'vehiclelights128' } }), // at taillights
          material({ color: [255, 255, 255, 255], texture: { maskName: '', name: 'vehiclelights128' } }), // mirror (far)
        ]),
        positions: new Float32Array([
          0.8,
          2,
          0,
          0.9,
          2,
          0,
          0.8,
          2,
          0.1, // verts 0-2 at the headlights dummy
          0.7,
          -2,
          0,
          0.8,
          -2,
          0,
          0.7,
          -2,
          0.1, // verts 3-5 at the taillights dummy
          0.9,
          0.5,
          0.8,
          1,
          0.5,
          0.8,
          0.9,
          0.5,
          0.9, // verts 6-8 by the mirror, far from both dummies
        ]),
        triangles: [
          { a: 0, b: 1, c: 2, materialIndex: 0 },
          { a: 3, b: 4, c: 5, materialIndex: 1 },
          { a: 6, b: 7, c: 8, materialIndex: 2 },
        ],
      };
      const clump: RWClump = {
        atomics: [{ frameIndex: 1, geometryIndex: 0 }],
        frames: [
          { name: 'root', parentIndex: -1, position: [0, 0, 0], rotation: id },
          { name: 'model_lights', parentIndex: 0, position: [0, 0, 0], rotation: id },
          { name: 'headlights', parentIndex: 0, position: [0.8, 2, 0], rotation: id },
          { name: 'taillights', parentIndex: 0, position: [0.7, -2, 0], rotation: id },
        ],
        geometries: [lights],
      };
      const mats = (buildVehicle(clump, new Map(), OPTIONS).root.children[0] as Mesh)
        .material as MeshStandardMaterial[];
      expect(mats.map((m) => m.userData.lightType as string | undefined)).toEqual(['head', 'tail', undefined]);
    });

    it('groups the _vlo atoms into a hidden lod group', () => {
      const { lod } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(lod).not.toBeNull();
      expect(lod?.visible).toBe(false);
      expect((lod?.children[0] as Mesh).name).toBe('chassis_vlo');
    });

    it('splits glass into two single-sided passes (back then front) so windows survive all angles', () => {
      const ok = buildVehicle(vehicleClump(), new Map(), OPTIONS).parts.find((p) => p.name === 'chassis')?.ok;
      const glass = (ok?.children ?? []).filter((child) => (child as Mesh).renderOrder > 0) as Mesh[];
      const glassSide = (m: Mesh): number => (m.material as MeshStandardMaterial[])[3].side; // index 3 = glass
      expect(glass).toHaveLength(2);
      expect(glass.map(glassSide).sort()).toEqual([FrontSide, BackSide].sort()); // single-sided, not DoubleSide
      const back = glass.find((m) => glassSide(m) === BackSide)?.renderOrder ?? 0;
      const front = glass.find((m) => glassSide(m) === FrontSide)?.renderOrder ?? 0;
      expect(back).toBeLessThan(front); // back faces drawn before front
      expect((glass[0].material as MeshStandardMaterial[])[3].depthWrite).toBe(false);
    });

    it('exposes _ok/_dam panels as damageable parts (dam hidden)', () => {
      const { parts } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const chassis = parts.find((p) => p.name === 'chassis');
      expect(chassis).toBeDefined();
      expect(chassis?.ok.visible).toBe(true);
      expect(chassis?.dam.visible).toBe(false);
      // The door is damageable too (has door_lf_dam).
      expect(parts.some((p) => p.name === 'door_lf')).toBe(true);
    });

    it('exposes the four wheels as rig handles (front pair flagged)', () => {
      const { wheels } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(wheels).toHaveLength(4);
      expect(wheels.filter((w) => w.front)).toHaveLength(2);
      expect(wheels.every((w) => w.radius > 0)).toBe(true);
    });

    it('wraps the door in a hinge pivot holding the door mesh', () => {
      const { doors } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const { pivot } = doors[0];
      expect([pivot.position.x, pivot.position.y, pivot.position.z]).toEqual([1, 2, 0]); // hinge dummy world pos
      expect((pivot.children[0] as Mesh).name).toBe('door_lf_ok');
    });

    it('exposes the seat dummy transforms', () => {
      const { seats } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(seats.frontseat).not.toBeNull();
      expect(seats.frontseat?.elements.slice(12, 15)).toEqual([0.5, 0, 0.2]);
      expect(seats.backseat).toBeNull();
    });

    it('places body parts by their frame world transform', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const chassis = group.parts.find((p) => p.name === 'chassis');
      expect(chassis?.position).toEqual([0, 0, 1]);
    });

    it('replaces paint markers with the carcol primary/secondary', () => {
      const materials = bodyMaterials(buildVehicle(vehicleClump(), new Map(), OPTIONS));
      expect([materials[0].color.r, materials[0].color.g, materials[0].color.b]).toEqual([1, 0, 0]);
      expect([materials[1].color.r, materials[1].color.g, materials[1].color.b]).toEqual([0, 0, 1]);
    });

    it('keeps non-marker materials untinted', () => {
      const materials = bodyMaterials(buildVehicle(vehicleClump(), new Map(), OPTIONS));
      expect(materials[2].color.getHex()).toBe((10 << 16) | (20 << 8) | 30);
    });

    it('replaces the 3rd-colour (255,175,0) marker with the tertiary paint', () => {
      const materials = bodyMaterials(buildVehicle(vehicleClump(), new Map(), OPTIONS));
      expect(materials[4].color.getHex()).toBe((11 << 16) | (22 << 8) | 33);
    });

    it('modulates non-marker textured materials by their RW colour (dark interiors)', () => {
      const vehicle = buildVehicle(vehicleClump(), new Map([['interior', new Texture()]]), OPTIONS);
      const materials = bodyMaterials(vehicle);
      expect(materials[5].map).not.toBeNull();
      expect(materials[5].color.getHex()).toBe((50 << 16) | (50 << 8) | 50);
    });

    it('scales wheels per front/rear (with the in-engine size boost)', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(wheelMesh(group, 'wheel_lf_dummy').scale.x).toBeCloseTo(0.5 * 1.25);
      expect(wheelMesh(group, 'wheel_lb_dummy').scale.x).toBeCloseTo(0.25 * 1.25);
    });

    it('blends translucent (glass) materials from the colour alpha, even when textured', () => {
      const group = buildVehicle(vehicleClump(), new Map([['glass', new Texture()]]), OPTIONS);
      const glass = bodyMaterials(group)[3];
      expect(glass.transparent).toBe(true);
      expect(glass.opacity).toBeCloseTo(128 / 255);
      expect(glass.depthWrite).toBe(false);
    });

    it('resolves textures from the supplied map', () => {
      const tex = new Texture();
      tex.name = 'carbody';
      const clump = vehicleClump();
      clump.geometries[0].materials[2].texture = { maskName: '', name: 'carbody' };
      const materials = bodyMaterials(buildVehicle(clump, new Map([['carbody', tex]]), OPTIONS));
      expect(materials[2].map?.name).toBe('carbody');
    });
  });
});

/** SA's second wheel convention: per-corner `wheel_{lf|rf|lb|rb}` atomics (different front/rear wheels),
 *  with no shared `wheel` atomic. Each wheel is modelled in place on its own frame. */
function cornerWheelClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [
      { frameIndex: 1, geometryIndex: 0 }, // chassis_ok
      { frameIndex: 2, geometryIndex: 1 }, // wheel_lf (front-left)
      { frameIndex: 3, geometryIndex: 1 }, // wheel_rf (front-right)
      { frameIndex: 4, geometryIndex: 1 }, // wheel_lb (rear-left)
      { frameIndex: 5, geometryIndex: 1 }, // wheel_rb (rear-right)
    ],
    frames: [
      { name: 'chassis', parentIndex: -1, position: [0, 0, 0], rotation: id },
      { name: 'chassis_ok', parentIndex: 0, position: [0, 0, 1], rotation: id },
      { name: 'wheel_lf', parentIndex: 0, position: [1, 2, 0], rotation: id },
      { name: 'wheel_rf', parentIndex: 0, position: [-1, 2, 0], rotation: id },
      { name: 'wheel_lb', parentIndex: 0, position: [1, -2, 0], rotation: id },
      { name: 'wheel_rb', parentIndex: 0, position: [-1, -2, 0], rotation: id },
    ],
    geometries: [bodyGeometry, wheelGeometry],
  };
}

/** A clump with neither a shared `wheel` atomic nor per-corner wheels (only the chassis body). */
function wheellessClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [{ frameIndex: 1, geometryIndex: 0 }],
    frames: [
      { name: 'chassis', parentIndex: -1, position: [0, 0, 0], rotation: id },
      { name: 'chassis_ok', parentIndex: 0, position: [0, 0, 1], rotation: id },
    ],
    geometries: [bodyGeometry],
  };
}

describe('buildVehicle (per-corner wheels)', () => {
  describe('negative cases', () => {
    it('builds no wheels when the clump has neither a shared nor per-corner wheel', () => {
      expect(buildVehicle(wheellessClump(), new Map(), OPTIONS).wheels).toHaveLength(0);
    });

    it('does not expose the per-corner wheel atomics as damageable parts', () => {
      const { parts } = buildVehicle(cornerWheelClump(), new Map(), OPTIONS);
      expect(parts.some((p) => p.name.startsWith('wheel_'))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('builds the four per-corner wheels as rig handles (front pair flagged)', () => {
      const { wheels } = buildVehicle(cornerWheelClump(), new Map(), OPTIONS);
      expect(wheels).toHaveLength(4);
      expect(wheels.filter((w) => w.front)).toHaveLength(2);
      expect(wheels.every((w) => w.radius > 0)).toBe(true);
    });

    it('places each wheel hub at its own frame world transform', () => {
      const { wheels } = buildVehicle(cornerWheelClump(), new Map(), OPTIONS);
      expect(wheels.map((w) => w.connection).sort()).toEqual(
        [
          [-1, -2, 0],
          [-1, 2, 0],
          [1, -2, 0],
          [1, 2, 0],
        ].sort(),
      );
    });

    it('wraps each wheel in a pivot → spinner → mesh rig (not wheel-scaled)', () => {
      const group = buildVehicle(cornerWheelClump(), new Map(), OPTIONS);
      const mesh = wheelMesh(group, 'wheel_lf'); // pivot.children[0].children[0]
      expect(mesh.name).toBe('wheel_lf_mesh');
      expect(mesh.scale.x).toBeCloseTo(1); // authored at size — not scaled by OPTIONS.wheelScale
    });

    it('mirrors the left (driver-side) wheels so they face outward, not inward', () => {
      const group = buildVehicle(cornerWheelClump(), new Map(), OPTIONS);
      expect(Math.abs(wheelMesh(group, 'wheel_lf').rotation.z)).toBeCloseTo(Math.PI); // left flipped 180°
      expect(Math.abs(wheelMesh(group, 'wheel_lb').rotation.z)).toBeCloseTo(Math.PI);
      expect(wheelMesh(group, 'wheel_rf').rotation.z).toBeCloseTo(0); // right authored facing out
      expect(wheelMesh(group, 'wheel_rb').rotation.z).toBeCloseTo(0);
    });
  });
});

/** A 3-axle (6-wheel) truck with per-corner wheels (front/middle/back × left/right) AND a stray bare
 *  `wheel` atomic some exporters leave in for compatibility. The per-corner wheels must win. */
function sixWheelCornerClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [
      { frameIndex: 1, geometryIndex: 0 }, // chassis_ok
      { frameIndex: 2, geometryIndex: 1 }, // wheel_lf
      { frameIndex: 3, geometryIndex: 1 }, // wheel_rf
      { frameIndex: 4, geometryIndex: 1 }, // wheel_lm (middle)
      { frameIndex: 5, geometryIndex: 1 }, // wheel_rm (middle)
      { frameIndex: 6, geometryIndex: 1 }, // wheel_lb
      { frameIndex: 7, geometryIndex: 1 }, // wheel_rb
      { frameIndex: 8, geometryIndex: 1 }, // bare wheel (stray — ignored)
    ],
    frames: [
      { name: 'chassis', parentIndex: -1, position: [0, 0, 0], rotation: id },
      { name: 'chassis_ok', parentIndex: 0, position: [0, 0, 1], rotation: id },
      { name: 'wheel_lf', parentIndex: 0, position: [1, 3, 0], rotation: id },
      { name: 'wheel_rf', parentIndex: 0, position: [-1, 3, 0], rotation: id },
      { name: 'wheel_lm', parentIndex: 0, position: [1, -1, 0], rotation: id },
      { name: 'wheel_rm', parentIndex: 0, position: [-1, -1, 0], rotation: id },
      { name: 'wheel_lb', parentIndex: 0, position: [1, -3, 0], rotation: id },
      { name: 'wheel_rb', parentIndex: 0, position: [-1, -3, 0], rotation: id },
      { name: 'wheel', parentIndex: 0, position: [-1, 3, 0], rotation: id },
    ],
    geometries: [bodyGeometry, wheelGeometry],
  };
}

/** A 3-axle truck using the shared `wheel` atomic instanced at six `wheel_*_dummy` frames. */
function sixWheelSharedClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [
      { frameIndex: 1, geometryIndex: 0 }, // chassis_ok
      { frameIndex: 2, geometryIndex: 1 }, // wheel (shared, instanced)
    ],
    frames: [
      { name: 'chassis', parentIndex: -1, position: [0, 0, 0], rotation: id },
      { name: 'chassis_ok', parentIndex: 0, position: [0, 0, 1], rotation: id },
      { name: 'wheel', parentIndex: 0, position: [0, 0, 0], rotation: id },
      { name: 'wheel_lf_dummy', parentIndex: 0, position: [1, 3, 0], rotation: id },
      { name: 'wheel_rf_dummy', parentIndex: 0, position: [-1, 3, 0], rotation: id },
      { name: 'wheel_lm_dummy', parentIndex: 0, position: [1, -1, 0], rotation: id },
      { name: 'wheel_rm_dummy', parentIndex: 0, position: [-1, -1, 0], rotation: id },
      { name: 'wheel_lb_dummy', parentIndex: 0, position: [1, -3, 0], rotation: id },
      { name: 'wheel_rb_dummy', parentIndex: 0, position: [-1, -3, 0], rotation: id },
    ],
    geometries: [bodyGeometry, wheelGeometry],
  };
}

describe('buildVehicle (3-axle trucks)', () => {
  describe('negative cases', () => {
    it('ignores the stray bare wheel atomic when per-corner wheels exist (no 7th / overlapping wheel)', () => {
      const group = buildVehicle(sixWheelCornerClump(), new Map(), OPTIONS);
      expect(group.wheels).toHaveLength(6);
      expect(group.root.children.map((c) => c.name)).not.toContain('wheel'); // stray neither rendered nor instanced
    });
  });

  describe('positive cases', () => {
    it('builds all six per-corner wheels (only the front axle steers)', () => {
      const { wheels } = buildVehicle(sixWheelCornerClump(), new Map(), OPTIONS);
      expect(wheels).toHaveLength(6);
      expect(wheels.filter((w) => w.front)).toHaveLength(2); // front axle only
    });

    it('instances the shared wheel at all six dummies, including the middle axle', () => {
      const { wheels } = buildVehicle(sixWheelSharedClump(), new Map(), OPTIONS);
      expect(wheels).toHaveLength(6);
      expect(wheels.filter((w) => w.front)).toHaveLength(2); // lf + rf
    });
  });
});

// A real SA vehicle (admiral.dff): full dummy rig, vehiclelights, prelit-free dynamic model.
const ADMIRAL = 'tests/dff/vehicle/admiral.dff';

describe.skipIf(!existsSync(ADMIRAL))('buildVehicle (real admiral.dff)', () => {
  const vehicle = buildVehicle(parseDff(toArrayBuffer(readFileSync(ADMIRAL))), new Map(), OPTIONS);

  /** Every MeshStandardMaterial reachable under the vehicle root. */
  function allMaterials(): MeshStandardMaterial[] {
    const out: MeshStandardMaterial[] = [];
    vehicle.root.traverse((child) => {
      const mesh = child as Mesh;
      if (!mesh.geometry) {
        return;
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      out.push(...(mats as MeshStandardMaterial[]));
    });

    return out;
  }

  describe('positive cases', () => {
    it('builds the full dummy rig (4 wheels, 4 doors) under an RWVehicle root', () => {
      expect(vehicle.root.name).toBe('RWVehicle');
      expect(vehicle.wheels).toHaveLength(4);
      expect(vehicle.doors).toHaveLength(4);
      expect(vehicle.parts.length).toBeGreaterThan(0);
    });

    it('extracts head/tail lamp dummies — front +Y, rear −Y, |x| kept for ±X mirroring', () => {
      const head = vehicle.root.userData.headlightDummy as number[];
      const tail = vehicle.root.userData.taillightDummy as number[];
      expect(head).toHaveLength(3);
      expect(tail).toHaveLength(3);
      expect(head.every(Number.isFinite)).toBe(true);
      expect(tail.every(Number.isFinite)).toBe(true);
      expect(head[1]).toBeGreaterThan(0); // headlights at the front (+Y)
      expect(tail[1]).toBeLessThan(0); // taillights at the rear (−Y)
      expect(head[0]).toBeGreaterThanOrEqual(0); // side offset stored as |x|
      expect(tail[0]).toBeGreaterThanOrEqual(0);
    });

    it('tags the vehiclelights materials by position (both head and tail present)', () => {
      const tags = allMaterials()
        .map((m) => m.userData.lightType as string | undefined)
        .filter(Boolean);
      expect(tags).toContain('head');
      expect(tags).toContain('tail');
    });

    it('leaves no non-finite vertex positions on any built mesh (sanitization invariant)', () => {
      let bad = 0;
      vehicle.root.traverse((child) => {
        const mesh = child as Mesh;
        const position = mesh.geometry?.getAttribute('position');
        if (position) {
          for (const value of position.array) {
            if (!Number.isFinite(value)) {
              bad += 1;
            }
          }
        }
      });
      expect(bad).toBe(0);
    });
  });
});

// Real per-corner vehicles (mod re-exports): each wheel is its own atomic, not a shared instanced wheel.
const PETRO_4 = 'tests/dff/vehicle/petro-4wheels.dff';
const PETRO_6 = 'tests/dff/vehicle/petro-6wheels.dff';

describe.skipIf(!existsSync(PETRO_4))('buildVehicle (real per-corner petro-4wheels.dff)', () => {
  const vehicle = buildVehicle(parseDff(toArrayBuffer(readFileSync(PETRO_4))), new Map(), OPTIONS);

  describe('positive cases', () => {
    it('builds the four per-corner wheels (front pair steers)', () => {
      expect(vehicle.wheels).toHaveLength(4);
      expect(vehicle.wheels.filter((w) => w.front)).toHaveLength(2);
      expect(vehicle.wheels.every((w) => w.radius > 0)).toBe(true);
    });

    it('mirrors the left (driver-side) wheels so they face outward', () => {
      expect(Math.abs(wheelMesh(vehicle, 'wheel_lf').rotation.z)).toBeCloseTo(Math.PI);
      expect(wheelMesh(vehicle, 'wheel_rf').rotation.z).toBeCloseTo(0);
    });
  });
});

describe.skipIf(!existsSync(PETRO_6))('buildVehicle (real 3-axle petro-6wheels.dff)', () => {
  const vehicle = buildVehicle(parseDff(toArrayBuffer(readFileSync(PETRO_6))), new Map(), OPTIONS);

  describe('negative cases', () => {
    it('ignores the stray bare wheel atomic (exactly six wheels, none rendered as a body mesh)', () => {
      expect(vehicle.wheels).toHaveLength(6);
      expect(vehicle.root.children.map((c) => c.name)).not.toContain('wheel');
    });
  });

  describe('positive cases', () => {
    it('builds all six per-corner wheels (only the front axle steers)', () => {
      expect(vehicle.wheels.filter((w) => w.front)).toHaveLength(2);
      expect(vehicle.wheels.every((w) => w.radius > 0)).toBe(true);
    });
  });
});
