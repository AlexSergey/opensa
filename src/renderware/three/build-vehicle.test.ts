import type { Mesh, MeshStandardMaterial } from 'three';

import { Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { buildVehicle, type VehicleOptions } from './build-vehicle';

const OPTIONS: VehicleOptions = {
  primary: [255, 0, 0],
  secondary: [0, 0, 255],
  wheelScale: [0.5, 0.25],
};

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

function triangleGeometry(materials: RWMaterial[]): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS,
    materials,
    normals: null,
    numUVLayers: 0,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: null,
    triangles: [{ a: 0, b: 1, c: 2, materialIndex: 0 }],
    uvLayers: [],
  };
}

/** Body geometry with primary + secondary paint markers and one plain material. */
const bodyGeometry = triangleGeometry([
  material({ color: [60, 255, 0, 255] }), // primary marker
  material({ color: [255, 0, 175, 255] }), // secondary marker
  material({ color: [10, 20, 30, 255] }), // plain
  material({ color: [255, 255, 255, 128], texture: { maskName: '', name: 'glass' } }), // translucent glass
]);
const wheelGeometry = triangleGeometry([material({ color: [40, 40, 40, 255] })]);

/** Materials of the `chassis` damageable part's undamaged (`_ok`) mesh. */
function bodyMaterials(vehicle: ReturnType<typeof buildVehicle>): MeshStandardMaterial[] {
  const ok = vehicle.parts.find((p) => p.name === 'chassis')?.ok as unknown as Mesh;

  return ok.material as MeshStandardMaterial[];
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

    it('groups the _vlo atoms into a hidden lod group', () => {
      const { lod } = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(lod).not.toBeNull();
      expect(lod?.visible).toBe(false);
      expect((lod?.children[0] as Mesh).name).toBe('chassis_vlo');
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
