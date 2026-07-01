import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createWeldSeamPrelit, type PrelitOverride } from './weld-seam-prelit';

function asset(name: string, meshes: SubMesh[]): Asset {
  return { dirty: false, ir: { meshes }, log: [], meta: {}, name, source: new Uint8Array() };
}

function mesh(positions: number[], prelit: null | number[]): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: prelit ? new Uint8Array(prelit) : null,
    triangles: [],
    uvs: null,
  };
}

const context: PipelineContext = { game: 'test', log: () => undefined };

describe('createWeldSeamPrelit', () => {
  describe('negative cases', () => {
    it('does not accept an asset with no overrides for its name', () => {
      const plugin = createWeldSeamPrelit(new Map([['other', []]]));
      expect(plugin.accepts?.(asset('m', []))).toBe(false);
    });

    it('leaves a mesh without prelit untouched', () => {
      const overrides = new Map<string, PrelitOverride[]>([['m', [{ pos: [0, 0, 0], rgb: [9, 9, 9] }]]]);
      const target = asset('m', [mesh([0, 0, 0], null)]);
      void createWeldSeamPrelit(overrides).transform(target, context);
      expect(target.dirty).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('overwrites RGB at the matched local position and keeps alpha; other vertices unchanged', () => {
      const overrides = new Map<string, PrelitOverride[]>([['m', [{ pos: [1, 0, 0], rgb: [50, 60, 70] }]]]);
      // vertex 0 at (0,0,0) — no override; vertex 1 at (1,0,0) — welded. Alpha 128 must survive.
      const target = asset('m', [mesh([0, 0, 0, 1, 0, 0], [11, 22, 33, 255, 200, 200, 200, 128])]);
      void createWeldSeamPrelit(overrides).transform(target, context);

      expect(target.dirty).toBe(true);
      expect([...target.ir.meshes[0].prelitColors!]).toEqual([11, 22, 33, 255, 50, 60, 70, 128]);
    });
  });
});
