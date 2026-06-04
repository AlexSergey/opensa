import type { MeshStandardMaterial } from 'three';

import { DoubleSide, FrontSide, Mesh, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parser/types';

import { GeometryFlag } from '../parser/constants';
import { buildClump } from './build-clump';

function alphaTextureMap(): Map<string, Texture> {
  const tex = new Texture();
  tex.name = 'tree_branches44';
  tex.userData.hasAlpha = true;

  return new Map([['tree_branches44', tex]]);
}

function clumpWith(geo: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'Mesh', parentIndex: -1, position: [1, 2, 3], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geo],
  };
}

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT | GeometryFlag.TEXTURED,
    materials: [
      material({ texture: { maskName: '', name: 'tree_branches44' }, textured: true }),
      material({ color: [200, 100, 50, 255] }),
    ],
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    prelitColors: new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 0, 255]),
    triangles: [
      { a: 0, b: 1, c: 2, materialIndex: 0 },
      { a: 0, b: 2, c: 3, materialIndex: 0 },
      { a: 1, b: 2, c: 3, materialIndex: 1 },
    ],
    uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
    ...partial,
  };
}

function material(partial: Partial<RWMaterial> = {}): RWMaterial {
  return { color: [255, 255, 255, 255], texture: null, textured: false, ...partial };
}

describe('buildClump', () => {
  it('creates one mesh per atomic, named after its frame', () => {
    const group = buildClump(clumpWith(geometry()));
    expect(group.children).toHaveLength(1);
    expect(group.children[0]).toBeInstanceOf(Mesh);
    expect(group.children[0].name).toBe('Mesh');
  });

  it('rotates the root from RenderWare Z-up to three.js Y-up', () => {
    const group = buildClump(clumpWith(geometry()));
    expect(group.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it('applies the frame transform to the mesh', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0];
    expect(mesh.position.toArray()).toEqual([1, 2, 3]);
  });

  it('builds position, uv and color attributes', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    const attrs = mesh.geometry.attributes;
    expect(attrs.position.count).toBe(4);
    expect(attrs.uv.count).toBe(4);
    expect(attrs.color.count).toBe(4);
    // prelit byte 255 -> normalized 1
    expect(attrs.color.getX(0)).toBeCloseTo(1, 5);
  });

  it('computes vertex normals when the geometry stores none', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    expect(mesh.geometry.attributes.normal).toBeDefined();
    expect(mesh.geometry.attributes.normal.count).toBe(4);
  });

  it('groups the index buffer by material', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    expect(mesh.geometry.index?.count).toBe(9); // 3 triangles
    expect(mesh.geometry.groups).toEqual([
      { count: 6, materialIndex: 0, start: 0 },
      { count: 3, materialIndex: 1, start: 6 },
    ]);
  });

  it('assigns the resolved texture and alpha settings to the material', () => {
    const mesh = buildClump(clumpWith(geometry()), alphaTextureMap()).children[0] as Mesh;
    const materials = mesh.material as MeshStandardMaterial[];
    expect(materials[0].map?.name).toBe('tree_branches44');
    expect(materials[0].transparent).toBe(true);
    expect(materials[0].alphaTest).toBe(0.5);
    expect(materials[0].side).toBe(DoubleSide);
    expect(materials[0].vertexColors).toBe(true);
  });

  it('uses the material colour and front-side rendering when untextured', () => {
    const mesh = buildClump(clumpWith(geometry())).children[0] as Mesh;
    const materials = mesh.material as MeshStandardMaterial[];
    expect(materials[1].side).toBe(FrontSide);
    expect(materials[1].transparent).toBe(false);
    expect(materials[1].color.getHex()).toBe((200 << 16) | (100 << 8) | 50);
  });

  it('preserves stored normals when present', () => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const mesh = buildClump(clumpWith(geometry({ normals }))).children[0] as Mesh;
    expect(Array.from(mesh.geometry.attributes.normal.array.slice(0, 3))).toEqual([0, 0, 1]);
  });
});
