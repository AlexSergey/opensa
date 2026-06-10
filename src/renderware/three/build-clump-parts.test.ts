import { Matrix4, Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWClump, RWGeometry, RWMaterial } from '../parsers/binary/types';

import { GeometryFlag } from '../parsers/binary/constants';
import { buildClumpParts } from './build-clump';

function clumpWith(geo: RWGeometry): RWClump {
  return {
    atomics: [{ frameIndex: 0, geometryIndex: 0 }],
    frames: [{ name: 'M', parentIndex: -1, position: [1, 2, 3], rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1] }],
    geometries: [geo],
  };
}

function geometry(partial: Partial<RWGeometry> = {}): RWGeometry {
  return {
    flags: GeometryFlag.POSITIONS | GeometryFlag.PRELIT,
    lights: [],
    materials: [
      material({ texture: { maskName: '', name: 'tree_branches44' }, textured: true }),
      material({ color: [200, 100, 50, 255] }),
    ],
    nightColors: null,
    normals: null,
    numUVLayers: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
    prelitColors: new Uint8Array(16).fill(255),
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

describe('buildClumpParts', () => {
  it('produces one single-material part per used material', () => {
    const parts = buildClumpParts(clumpWith(geometry()));
    expect(parts).toHaveLength(2);
    // material 0: 2 triangles -> 6 indices; material 1: 1 triangle -> 3 indices
    expect(parts[0].geometry.getIndex()?.count).toBe(6);
    expect(parts[1].geometry.getIndex()?.count).toBe(3);
    // single material, no multi-material groups
    expect(parts[0].geometry.groups).toHaveLength(0);
    expect(Array.isArray(parts[0].material)).toBe(false);
  });

  it('carries the atomic frame transform as the part matrix (native, no up-axis flip)', () => {
    const parts = buildClumpParts(clumpWith(geometry()));
    const position = new Matrix4().copy(parts[0].matrix).elements.slice(12, 15);
    expect(position).toEqual([1, 2, 3]);
  });

  it('builds position/uv/color attributes and computes normals when absent', () => {
    const parts = buildClumpParts(clumpWith(geometry()));
    const attrs = parts[0].geometry.attributes;
    expect(attrs.position.count).toBe(4);
    expect(attrs.uv.count).toBe(4);
    expect(attrs.color.count).toBe(4);
    expect(attrs.normal).toBeDefined();
  });

  it('repairs zero-length normals on coincident opposite-wound faces (no black panels)', () => {
    // A flat double-sided quad: front + back triangles share the same vertices with opposite winding, so
    // computeVertexNormals cancels every normal to zero (the SA neon-sign / unclean-road case). The repair
    // must leave a usable (non-zero, unit) normal so the face is lit instead of rendering pure black.
    const panel = geometry({
      materials: [material({ color: [255, 255, 255, 255] })],
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
      triangles: [
        { a: 0, b: 1, c: 2, materialIndex: 0 },
        { a: 0, b: 2, c: 3, materialIndex: 0 },
        { a: 0, b: 2, c: 1, materialIndex: 0 },
        { a: 0, b: 3, c: 2, materialIndex: 0 },
      ],
      uvLayers: [new Float32Array([0, 0, 1, 0, 1, 1, 0, 1])],
    });
    const normal = buildClumpParts(clumpWith(panel))[0].geometry.getAttribute('normal');
    for (let i = 0; i < normal.count; i += 1) {
      const length = Math.hypot(normal.getX(i), normal.getY(i), normal.getZ(i));
      expect(length).toBeGreaterThan(0.99);
    }
  });

  it('exposes prelit-alpha sway weights only when some alpha is below 255 (plan 039)', () => {
    // Fixture prelit is opaque (all alphas 255) → no sway data.
    const plain = buildClumpParts(clumpWith(geometry()));
    expect(plain[0].swayAlphaMin).toBeUndefined();
    expect(plain[0].geometry.getAttribute('swayWeight')).toBeUndefined();

    // Wind-adapted: canopy alphas at 0xAA (the cedar convention) → weight (255−170)/255.
    const prelit = new Uint8Array(16).fill(255);
    prelit[7] = 170; // vertex 1's alpha
    const adapted = buildClumpParts(clumpWith(geometry({ prelitColors: prelit })));
    expect(adapted[0].swayAlphaMin).toBe(170);
    const weights = adapted[0].geometry.getAttribute('swayWeight');
    expect(weights.getX(0)).toBe(0);
    expect(weights.getX(1)).toBeCloseTo((255 - 170) / 255, 5);
  });

  it('resolves textures and alpha settings into the part material', () => {
    const tex = new Texture();
    tex.name = 'tree_branches44';
    tex.userData.hasAlpha = true;
    const parts = buildClumpParts(clumpWith(geometry()), new Map([['tree_branches44', tex]]));
    const mat = parts[0].material;
    expect(mat.map?.name).toBe('tree_branches44');
    expect(mat.transparent).toBe(true);
    expect(mat.vertexColors).toBe(true);
  });
});
