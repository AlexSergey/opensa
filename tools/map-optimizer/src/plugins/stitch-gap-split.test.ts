import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createStitchGapSplit, type EdgeSplitOverride } from './stitch-gap-split';

const context: PipelineContext = { game: 'test', log: () => undefined };

function asset(name: string, meshes: SubMesh[]): Asset {
  return { dirty: false, ir: { meshes }, log: [], meta: {}, name, source: new Uint8Array() };
}

/** A single triangle (0,0,0)-(2,0,0)-(0,2,0) with UV + prelit, all edges open. */
function triangleMesh(): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]),
    prelitColors: new Uint8Array([0, 0, 0, 255, 200, 0, 0, 255, 0, 200, 0, 255]),
    triangles: [{ a: 0, b: 1, c: 2, material: 0 }],
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  };
}

describe('createStitchGapSplit', () => {
  describe('negative cases', () => {
    it('does not accept an asset with no splits for its name', () => {
      expect(createStitchGapSplit(new Map([['other', []]])).accepts?.(asset('m', []))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('inserts a vertex at the midpoint of an edge (attrs exactly interpolated) and re-triangulates', () => {
      const splits = new Map<string, EdgeSplitOverride[]>([
        [
          'm',
          [
            {
              edge: [
                [0, 0, 0],
                [2, 0, 0],
              ],
              t: 0.5,
            },
          ],
        ],
      ]);
      const target = asset('m', [triangleMesh()]);
      void createStitchGapSplit(splits).transform(target, context);
      const mesh = target.ir.meshes[0];

      expect(target.dirty).toBe(true);
      expect(mesh.positions.length / 3).toBe(4); // one vertex added
      expect(mesh.triangles.length).toBe(2); // the triangle fanned through the split point
      // the new vertex (index 3) is the exact midpoint of the edge, with interpolated UV + prelit.
      expect([...mesh.positions.slice(9)]).toEqual([1, 0, 0]);
      expect([...mesh.uvs!.slice(6)]).toEqual([0.5, 0]);
      expect([...mesh.prelitColors!.slice(12)]).toEqual([100, 0, 0, 255]);
    });
  });
});
