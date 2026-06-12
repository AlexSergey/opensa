import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { CollisionIndex } from '../collision';
import type { ColModel } from '../parsers/binary/col-types';
import type { ProcObjBatch, ProcObjPlacement } from './procobj-scatter';

import { procObjColliders } from './procobj-colliders';

function placement(partial: Partial<ProcObjPlacement> = {}): ProcObjPlacement {
  return {
    align: false,
    lottery: 0.5,
    normal: [0, 0, 1],
    position: [10, 20, 5],
    rotation: 0,
    scale: 1,
    scaleZ: 1,
    ...partial,
  };
}

function rockCol(): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [1, 1, 1], min: [-1, -1, -1], radius: 2 },
    boxes: [],
    faces: [{ a: 0, b: 1, c: 2, light: 0, material: 0 }],
    modelId: 0,
    name: 'p_rubble05col',
    spheres: [],
    version: 2,
    vertices: new Float32Array(9),
  };
}

const index: CollisionIndex = new Map([['p_rubble05col', rockCol()]]);

describe('procObjColliders', () => {
  describe('negative cases', () => {
    it('skips models without a COL (grass/flowers stay walk-through)', () => {
      const batch: ProcObjBatch = { category: 'grass', model: 'veg_procgrasspatch', placements: [placement()] };
      expect(procObjColliders(index, [batch])).toEqual([]);
    });

    it('skips batches whose placements are all above the vanilla density', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement({ lottery: 1.5 }), placement({ lottery: 2.5 })],
      };
      expect(procObjColliders(index, [batch])).toEqual([]);
    });

    it('collides nothing for a disabled category (densityOf → 0)', () => {
      const batch: ProcObjBatch = { category: 'rocks', model: 'p_rubble05col', placements: [placement()] };
      expect(procObjColliders(index, [batch], { densityOf: () => 0 })).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('collides the vanilla (lottery < 1) subset at the render pose', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement({ lottery: 0.2, position: [10, 20, 5] }), placement({ lottery: 1.2 })],
      };
      const colliders = procObjColliders(index, [batch]);
      expect(colliders).toHaveLength(1);
      expect(colliders[0].name).toBe('p_rubble05col');
      expect(colliders[0].col).toBe(index.get('p_rubble05col'));
      expect(colliders[0].transforms).toHaveLength(1); // only the vanilla-density placement
      const position = new Vector3().setFromMatrixPosition(colliders[0].transforms[0]);
      expect([position.x, position.y, position.z]).toEqual([10, 20, 5]);
    });

    it('follows the live per-category density (collision matches the rendered set)', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [placement({ lottery: 0.2 }), placement({ lottery: 1.2 }), placement({ lottery: 2.4 })],
      };
      expect(procObjColliders(index, [batch], { densityOf: () => 3 })[0].transforms).toHaveLength(3);
      expect(procObjColliders(index, [batch], { densityOf: () => 1.5 })[0].transforms).toHaveLength(2);
      expect(procObjColliders(index, [batch], { densityOf: () => 0.1 })).toEqual([]);
    });

    it('never collides what the procObjLimit hides (lotteryCap = rendered set)', () => {
      const batch: ProcObjBatch = {
        category: 'rocks',
        model: 'p_rubble05col',
        placements: [
          placement({ lottery: 0.2, position: [1, 0, 0] }),
          placement({ lottery: 0.8, position: [2, 0, 0] }),
        ],
      };
      const colliders = procObjColliders(index, [batch], { densityOf: () => 3, lotteryCap: 0.5 });
      expect(colliders[0].transforms).toHaveLength(1); // lottery 0.8 is beyond the limit → no body
      const x = new Vector3().setFromMatrixPosition(colliders[0].transforms[0]).x;
      expect(x).toBe(1); // the lowest-lottery (rendered) placement survives
    });
  });
});
