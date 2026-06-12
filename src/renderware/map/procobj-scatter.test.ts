import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';

import type { ColModel } from '../parsers/binary/col-types';
import type { ProcObjRule } from '../parsers/text';
import type { RegionColliders } from '../collision';

import { procObjCategory } from './procobj-categories';
import { groupRulesBySurface, PROC_OBJ_MAX_DENSITY, procObjLotteryCap, scatterProcObjects } from './procobj-scatter';

/** Right triangle (0,0)-(20,0)-(0,20) at z=0 — area exactly 200 m². */
function triangleCollider(material: number, transform = new Matrix4()): RegionColliders {
  const col: ColModel = {
    bounds: { center: [0, 0, 0], max: [20, 20, 0], min: [0, 0, 0], radius: 30 },
    boxes: [],
    faces: [{ a: 0, b: 1, c: 2, light: 0, material }],
    modelId: 0,
    name: 'ground',
    spheres: [],
    version: 1,
    vertices: new Float32Array([0, 0, 0, 20, 0, 0, 0, 20, 0]),
  };

  return { col, name: 'ground', transforms: [transform] };
}

function rule(partial: Partial<ProcObjRule> = {}): ProcObjRule {
  return {
    align: true,
    maxRotation: 360,
    maxScale: 1.5,
    maxScaleZ: 1.2,
    minDistance: 60,
    minRotation: 0,
    minScale: 0.5,
    minScaleZ: 0.4,
    model: 'sand_combush02',
    spacing: 10,
    surface: 'p_sand',
    useGrid: false,
    zOffsetMax: -0.3,
    zOffsetMin: -0.3,
    ...partial,
  };
}

// surfinfo table: index = COL material id.
const SURFACES = ['default', 'p_sand', 'p_underwaterbarren'];

describe('scatterProcObjects', () => {
  describe('negative cases', () => {
    it('skips faces whose material is outside the surface table', () => {
      const batches = scatterProcObjects([triangleCollider(99)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });

    it('skips faces whose surface has no rules', () => {
      const batches = scatterProcObjects([triangleCollider(0)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });

    it('skips degenerate (zero-area) faces', () => {
      const collider = triangleCollider(1);
      collider.col.vertices = new Float32Array(9); // all three vertices at the origin
      const batches = scatterProcObjects([collider], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('is deterministic — same cell gives byte-identical placements, other cells differ', () => {
      const rules = groupRulesBySurface([rule()]);
      const first = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 3, -7);
      const second = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 3, -7);
      expect(second).toEqual(first);
      const other = scatterProcObjects([triangleCollider(1)], rules, SURFACES, 4, -7);
      expect(other).not.toEqual(first);
    });

    it('generates MAX_DENSITY × the vanilla count, lottery-sorted for the density cutoff', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches).toHaveLength(1);
      const { placements } = batches[0];
      expect(placements).toHaveLength((200 / 10) * PROC_OBJ_MAX_DENSITY); // area 200, spacing 10
      for (let i = 1; i < placements.length; i += 1) {
        expect(placements[i].lottery).toBeGreaterThanOrEqual(placements[i - 1].lottery);
      }
      // Vanilla density 1 ⇒ the cutoff keeps roughly the authored 20 objects.
      const vanilla = placements.filter((placement) => placement.lottery < 1).length;
      expect(vanilla).toBeGreaterThan(10);
      expect(vanilla).toBeLessThan(30);
    });

    it('places inside the face with the rule ranges applied (scale/rotation/z-offset/normal)', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 1, 2);
      for (const placement of batches[0].placements) {
        const [x, y, z] = placement.position;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x + y).toBeLessThanOrEqual(20.0001); // inside the triangle
        expect(z).toBeCloseTo(-0.3, 5); // zOffMin == zOffMax == −0.3
        expect(placement.normal).toEqual([0, 0, 1]);
        expect(placement.align).toBe(true);
        expect(placement.scale).toBeGreaterThanOrEqual(0.5);
        expect(placement.scale).toBeLessThanOrEqual(1.5);
        expect(placement.scaleZ).toBeGreaterThanOrEqual(0.4);
        expect(placement.scaleZ).toBeLessThanOrEqual(1.2);
        expect(placement.rotation).toBeGreaterThanOrEqual(0);
        expect(placement.rotation).toBeLessThanOrEqual(Math.PI * 2);
      }
    });

    it('flips downward face normals up — clutter grows OUT of the ground (winding-proof)', () => {
      // Same triangle with reversed winding: raw (b−a)×(c−a) points (0,0,−1).
      const collider = triangleCollider(1);
      collider.col.faces = [{ a: 0, b: 2, c: 1, light: 0, material: 1 }];
      const batches = scatterProcObjects([collider], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(batches[0].placements.length).toBeGreaterThan(0);
      for (const placement of batches[0].placements) {
        // (toBeCloseTo: negate() leaves −0 components, which toEqual would distinguish from 0)
        expect(placement.normal[0]).toBeCloseTo(0, 9);
        expect(placement.normal[1]).toBeCloseTo(0, 9);
        expect(placement.normal[2]).toBeCloseTo(1, 9); // align rules must not plant bushes upside-down
      }
    });

    it('applies the placement world transform', () => {
      const moved = triangleCollider(1, new Matrix4().makeTranslation(100, 50, 7));
      const batches = scatterProcObjects([moved], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      for (const placement of batches[0].placements) {
        expect(placement.position[0]).toBeGreaterThanOrEqual(100);
        expect(placement.position[1]).toBeGreaterThanOrEqual(50);
        expect(placement.position[2]).toBeCloseTo(7 - 0.3, 5);
      }
    });

    it('batches per model with the semantic category resolved', () => {
      const rules = groupRulesBySurface([
        rule(),
        rule({ model: 'searock01', spacing: 20, surface: 'p_underwaterbarren' }),
      ]);
      const colliders = [triangleCollider(1), triangleCollider(2)];
      const batches = scatterProcObjects(colliders, rules, SURFACES, 0, 0);
      const byModel = new Map(batches.map((batch) => [batch.model, batch]));
      expect(byModel.get('sand_combush02')?.category).toBe('bushes');
      expect(byModel.get('searock01')?.category).toBe('underwater');
    });
  });
});

describe('procObjLotteryCap', () => {
  describe('negative cases', () => {
    it('is unlimited without a limit or when under it', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      expect(procObjLotteryCap(batches)).toBe(Number.POSITIVE_INFINITY);
      expect(procObjLotteryCap(batches, 10_000)).toBe(Number.POSITIVE_INFINITY);
    });
  });

  describe('positive cases', () => {
    it('returns the threshold below which exactly `limit` placements fall, cell-wide', () => {
      const batches = scatterProcObjects([triangleCollider(1)], groupRulesBySurface([rule()]), SURFACES, 0, 0);
      const cap = procObjLotteryCap(batches, 25);
      const kept = batches.flatMap((batch) => batch.placements).filter((placement) => placement.lottery < cap);
      expect(kept).toHaveLength(25);
    });
  });
});

describe('procObjCategory', () => {
  describe('negative cases', () => {
    it('falls back to bushes for unknown models', () => {
      expect(procObjCategory('future_model', 'p_sand')).toBe('bushes');
    });
  });

  describe('positive cases', () => {
    it('maps the procobj.dat models to their groups', () => {
      expect(procObjCategory('sjmcacti2', 'p_sand')).toBe('cacti');
      expect(procObjCategory('veg_procgrasspatch', 'p_grass_dry')).toBe('grass');
      expect(procObjCategory('veg_Pflowers03', 'p_flowerbed')).toBe('flowers');
      expect(procObjCategory('Cedar1_PO', 'p_bushydry')).toBe('trees');
      expect(procObjCategory('p_rubble', 'p_mountain')).toBe('rocks');
    });

    it('forces underwater for anything on the sea floor (rubble rules reused there)', () => {
      expect(procObjCategory('p_rubble', 'p_underwaterbarren')).toBe('underwater');
    });
  });
});
