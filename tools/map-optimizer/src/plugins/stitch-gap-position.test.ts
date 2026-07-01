import { describe, expect, it } from 'vitest';

import type { Asset, PipelineContext } from '../core/asset';
import type { SubMesh } from '../core/ir';

import { createStitchGapPosition, type StitchOverride } from './stitch-gap-position';

function asset(name: string, meshes: SubMesh[]): Asset {
  return { dirty: false, ir: { meshes }, log: [], meta: {}, name, source: new Uint8Array() };
}

function mesh(positions: number[]): SubMesh {
  return {
    materialCount: 1,
    name: 'm',
    nightColors: null,
    normals: null,
    positions: new Float32Array(positions),
    prelitColors: null,
    triangles: [],
    uvs: null,
  };
}

const context: PipelineContext = { game: 'test', log: () => undefined };

describe('createStitchGapPosition', () => {
  describe('negative cases', () => {
    it('does not accept an asset with no overrides for its name', () => {
      const plugin = createStitchGapPosition(new Map([['other', []]]));
      expect(plugin.accepts?.(asset('m', []))).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('overwrites the position at the matched original local position; other vertices unchanged', () => {
      const overrides = new Map<string, StitchOverride[]>([['m', [{ newPos: [1.125, 0, 0], pos: [1, 0, 0] }]]]);
      // vertex 0 at (0,0,0) — no override; vertex 1 at (1,0,0) — moved to (1.125,0,0).
      const target = asset('m', [mesh([0, 0, 0, 1, 0, 0])]);
      void createStitchGapPosition(overrides).transform(target, context);

      expect(target.dirty).toBe(true);
      expect([...target.ir.meshes[0].positions]).toEqual([0, 0, 0, 1.125, 0, 0]);
    });
  });
});
