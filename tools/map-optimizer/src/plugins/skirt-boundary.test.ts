import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createSkirtBoundary, type SkirtOverride } from './skirt-boundary';

const context: PipelineContext = { game: 'test', log: () => undefined };

function asset(name: string, meshes: SubMesh[]): Asset {
  return { dirty: false, ir: { meshes }, log: [], meta: {}, name, source: new Uint8Array() };
}

/** A single triangle with UV + prelit; all edges are open (boundary). */
function triangleMesh(): SubMesh {
  return {
    materialCount: 3,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    prelitColors: new Uint8Array([10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255]),
    triangles: [{ a: 0, b: 1, c: 2, material: 2 }],
    uvs: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]),
  };
}

describe('createSkirtBoundary', () => {
  describe('negative cases', () => {
    it('does not accept an asset with no skirts for its name', () => {
      expect(createSkirtBoundary(new Map([['other', []]])).accepts?.(asset('m', []))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('extrudes an edge into a double-sided skirt whose verts copy the edge attrs at the new position', () => {
      const skirts = new Map<string, SkirtOverride[]>([
        ['m', [{ a: [0, 0, 0], b: [1, 0, 0], belowA: [0, 0, -1.5], belowB: [1, 0, -1.5] }]],
      ]);
      const target = asset('m', [triangleMesh()]);
      void createSkirtBoundary(skirts).transform(target, context);
      const mesh = target.ir.meshes[0];

      expect(target.dirty).toBe(true);
      expect(mesh.positions.length / 3).toBe(5); // two skirt vertices added
      expect(mesh.triangles.length).toBe(5); // original + a 4-triangle double-sided quad
      // the two new vertices sit at the extruded positions...
      expect([...mesh.positions.slice(9)]).toEqual([0, 0, -1.5, 1, 0, -1.5]);
      // ...copying vertex 0 / vertex 1's UV + prelit exactly.
      expect([...mesh.uvs!.slice(6)]).toEqual([...mesh.uvs!.slice(0, 4)]);
      expect([...mesh.prelitColors!.slice(12)]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
      // every added triangle inherits the edge's material (2).
      expect(mesh.triangles.every((t) => t.material === 2)).toBe(true);
    });
  });
});
