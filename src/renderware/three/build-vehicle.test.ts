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

function meshByName(group: ReturnType<typeof buildVehicle>, name: string): Mesh {
  return group.children.find((child) => child.name === name) as Mesh;
}

function vehicleClump(): RWClump {
  const id = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  return {
    atomics: [
      { frameIndex: 1, geometryIndex: 0 }, // chassis_ok
      { frameIndex: 2, geometryIndex: 0 }, // chassis_dam  (skipped)
      { frameIndex: 3, geometryIndex: 0 }, // chassis_vlo  (skipped)
      { frameIndex: 4, geometryIndex: 1 }, // wheel        (instanced)
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
    ],
    geometries: [bodyGeometry, wheelGeometry],
  };
}

describe('buildVehicle', () => {
  describe('negative cases', () => {
    it('skips the damaged and LOD body atoms', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const names = group.children.map((child) => child.name);
      expect(names).not.toContain('chassis_dam');
      expect(names).not.toContain('chassis_vlo');
    });

    it('does not render the bare wheel atomic as its own mesh', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(group.children.map((child) => child.name)).not.toContain('wheel');
    });
  });

  describe('positive cases', () => {
    it('renders the body and instances the wheel at the four dummies', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const names = group.children.map((child) => child.name).sort();
      expect(names).toEqual(['chassis_ok', 'wheel_lb_dummy', 'wheel_lf_dummy', 'wheel_rb_dummy', 'wheel_rf_dummy']);
    });

    it('places body parts by their frame world transform', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const body = meshByName(group, 'chassis_ok');
      expect([body.position.x, body.position.y, body.position.z]).toEqual([0, 0, 1]);
    });

    it('replaces paint markers with the carcol primary/secondary', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const materials = meshByName(group, 'chassis_ok').material as MeshStandardMaterial[];
      expect([materials[0].color.r, materials[0].color.g, materials[0].color.b]).toEqual([1, 0, 0]);
      expect([materials[1].color.r, materials[1].color.g, materials[1].color.b]).toEqual([0, 0, 1]);
    });

    it('keeps non-marker materials untinted', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      const materials = meshByName(group, 'chassis_ok').material as MeshStandardMaterial[];
      expect(materials[2].color.getHex()).toBe((10 << 16) | (20 << 8) | 30);
    });

    it('scales wheels per front/rear (with the in-engine size boost)', () => {
      const group = buildVehicle(vehicleClump(), new Map(), OPTIONS);
      expect(meshByName(group, 'wheel_lf_dummy').scale.x).toBeCloseTo(0.5 * 1.25);
      expect(meshByName(group, 'wheel_lb_dummy').scale.x).toBeCloseTo(0.25 * 1.25);
    });

    it('blends translucent (glass) materials from the colour alpha, even when textured', () => {
      const group = buildVehicle(vehicleClump(), new Map([['glass', new Texture()]]), OPTIONS);
      const glass = (meshByName(group, 'chassis_ok').material as MeshStandardMaterial[])[3];
      expect(glass.transparent).toBe(true);
      expect(glass.opacity).toBeCloseTo(128 / 255);
      expect(glass.depthWrite).toBe(false);
    });

    it('resolves textures from the supplied map', () => {
      const tex = new Texture();
      tex.name = 'carbody';
      const clump = vehicleClump();
      clump.geometries[0].materials[2].texture = { maskName: '', name: 'carbody' };
      const group = buildVehicle(clump, new Map([['carbody', tex]]), OPTIONS);
      const materials = meshByName(group, 'chassis_ok').material as MeshStandardMaterial[];
      expect(materials[2].map?.name).toBe('carbody');
    });
  });
});
