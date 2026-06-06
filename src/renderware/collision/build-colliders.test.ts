import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import type { ColModel } from '../parsers/binary/col-types';
import type { IdeObjectDef, IplInstance, MapDefinitions } from '../parsers/text';
import type { CollisionIndex } from './collision-index';

import { buildColliders } from './build-colliders';

type Vec3 = [number, number, number];

function colModel(name: string, modelId = 0): ColModel {
  return {
    bounds: { center: [0, 0, 0], max: [0, 0, 0], min: [0, 0, 0], radius: 0 },
    boxes: [],
    faces: [],
    modelId,
    name,
    spheres: [],
    version: 2,
    vertices: new Float32Array(),
  };
}

function def(id: number, modelName: string): IdeObjectDef {
  return { drawDistance: 300, flags: 0, id, modelName, txdName: 'txd' };
}

function index(...models: ColModel[]): CollisionIndex {
  return new Map(models.map((m) => [m.name.toLowerCase(), m]));
}

function inst(
  id: number,
  position: Vec3,
  options: { interior?: number; rotation?: [number, number, number, number] } = {},
): IplInstance {
  return {
    id,
    interior: options.interior ?? 0,
    lod: -1,
    modelName: '',
    position,
    rotation: options.rotation ?? [0, 0, 0, 1],
  };
}

function mapDefs(defs: IdeObjectDef[], instances: IplInstance[]): MapDefinitions {
  return { catalog: new Map(defs.map((d) => [d.id, d])), imgDirs: [], instances };
}

const WHOLE_MAP: { center: Vec3; radius: number } = { center: [0, 0, 0], radius: Infinity };

describe('buildColliders', () => {
  describe('negative cases', () => {
    it('skips instances whose id is not in the catalog', () => {
      const defs = mapDefs([def(1, 'wall')], [inst(99, [0, 0, 0])]);
      expect(buildColliders(index(colModel('wall')), defs, WHOLE_MAP)).toEqual([]);
    });

    it('skips hidden-interior instances', () => {
      const defs = mapDefs([def(1, 'wall')], [inst(1, [0, 0, 0], { interior: 10 })]);
      expect(buildColliders(index(colModel('wall')), defs, WHOLE_MAP)).toEqual([]);
    });

    it('skips LOD models (they have no collision)', () => {
      const defs = mapDefs([def(1, 'LODwall')], [inst(1, [0, 0, 0])]);
      expect(buildColliders(index(colModel('lodwall')), defs, WHOLE_MAP)).toEqual([]);
    });

    it('skips instances outside the radius', () => {
      const defs = mapDefs([def(1, 'wall')], [inst(1, [500, 0, 0])]);
      const colliders = buildColliders(index(colModel('wall')), defs, { center: [0, 0, 0], radius: 100 });
      expect(colliders).toEqual([]);
    });

    it('skips models that have no collision in the index', () => {
      const defs = mapDefs([def(1, 'wall')], [inst(1, [0, 0, 0])]);
      expect(buildColliders(index(), defs, WHOLE_MAP)).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('binds exterior instances with a non-zero world area code (256-multiple or id 13)', () => {
      const defs = mapDefs(
        [def(1, 'wall')],
        [inst(1, [0, 0, 0], { interior: 1024 }), inst(1, [5, 5, 5], { interior: 13 })],
      );
      const colliders = buildColliders(index(colModel('wall')), defs, WHOLE_MAP);
      expect(colliders).toHaveLength(1);
      expect(colliders[0].transforms).toHaveLength(2);
    });

    it('binds a placed model to its collision with one transform per placement', () => {
      const defs = mapDefs([def(1, 'wall')], [inst(1, [10, 20, 30]), inst(1, [40, 50, 60])]);
      const colliders = buildColliders(index(colModel('wall', 7)), defs, WHOLE_MAP);

      expect(colliders).toHaveLength(1);
      expect(colliders[0].name).toBe('wall');
      expect(colliders[0].col.modelId).toBe(7);
      expect(colliders[0].transforms).toHaveLength(2);
    });

    it('places the transform at the instance position with the conjugated rotation', () => {
      // 90° about Z: (x,y,z,w) = (0, 0, sin45, cos45); conjugate negates the vector part.
      const rotation: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
      const defs = mapDefs([def(1, 'wall')], [inst(1, [10, 20, 30], { rotation })]);

      const [collider] = buildColliders(index(colModel('wall')), defs, WHOLE_MAP);
      const position = new Vector3();
      const quaternion = new Quaternion();
      collider.transforms[0].decompose(position, quaternion, new Vector3());

      expect([position.x, position.y, position.z]).toEqual([10, 20, 30]);
      expect(quaternion.z).toBeCloseTo(-Math.SQRT1_2);
      expect(quaternion.w).toBeCloseTo(Math.SQRT1_2);
    });

    it('groups instances of different models into separate entries', () => {
      const defs = mapDefs(
        [def(1, 'wall'), def(2, 'gate')],
        [inst(1, [0, 0, 0]), inst(2, [1, 1, 1]), inst(1, [2, 2, 2])],
      );
      const colliders = buildColliders(index(colModel('wall'), colModel('gate')), defs, WHOLE_MAP);

      const byName = new Map(colliders.map((c) => [c.name, c.transforms.length]));
      expect(byName.get('wall')).toBe(2);
      expect(byName.get('gate')).toBe(1);
    });
  });
});
