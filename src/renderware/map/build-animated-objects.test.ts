import type { Object3D, Quaternion } from 'three';

import { readFileSync } from 'node:fs';
import { DoubleSide, Group } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance } from '../parsers/text';

import { buildArchiveBuffer, openArchive } from '../archive';
import { resetAnimatedObjects, updateAnimatedObjects } from '../three/animated-objects';
import { buildAnimatedObjects, buildInstancedMeshes } from './build-region';

// Real IDE `anim` row from counxref.ide: the oil-field nodding donkey at (628.1, 1354.4, 11.4).
const CASE_DIR = 'tests/dff/anim-clump';

const pumpDef: IdeObjectDef = {
  anim: 'counxref',
  drawDistance: 200,
  flags: 0x200000, // DISABLE_BACKFACE_CULLING — the real counxref.ide flags
  id: 3426,
  modelName: 'nt_noddonkbase',
  txdName: 'des_xoilfield',
};

const pumpInstance: IplInstance = {
  id: 3426,
  interior: 0,
  lod: -1,
  modelName: '',
  position: [628.1, 1354.4, 11.4],
  rotation: [0, 0, 0, 1],
};

function caseArchive(): ReturnType<typeof openArchive> {
  return openArchive(
    buildArchiveBuffer([
      { data: readFileSync(`${CASE_DIR}/nt_noddonkbase.dff`), name: 'nt_noddonkbase.dff' },
      { data: readFileSync(`${CASE_DIR}/counxref.ifp`), name: 'counxref.ifp' },
    ]),
  );
}

beforeEach(() => {
  resetAnimatedObjects();
});

describe('buildAnimatedObjects', () => {
  describe('negative cases', () => {
    it('skips groups whose def has no anim name', () => {
      const objects = buildAnimatedObjects(caseArchive(), [
        { def: { ...pumpDef, anim: undefined }, instances: [pumpInstance] },
      ]);
      expect(objects).toEqual([]);
    });

    it('buildInstancedMeshes skips anim defs (they take the per-instance path)', () => {
      const meshes = buildInstancedMeshes(caseArchive(), [{ def: pumpDef, instances: [pumpInstance] }]);
      expect(meshes).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('builds one placed group per instance with region data for picking', () => {
      const second: IplInstance = { ...pumpInstance, position: [640, 1360, 11.4] };
      const objects = buildAnimatedObjects(caseArchive(), [{ def: pumpDef, instances: [pumpInstance, second] }]);
      expect(objects).toHaveLength(2);
      expect(objects[0].position.x).toBeCloseTo(628.1, 5);
      expect(objects[1].position.x).toBeCloseTo(640, 5);
      const region = objects[0].userData.region as { def: IdeObjectDef; instances: IplInstance[] };
      expect(region.def).toBe(pumpDef);
      expect(region.instances).toEqual([pumpInstance]);
    });

    it('applies the IDE-flag treatment to the animated meshes (real 0x200000 = double-sided)', () => {
      const objects = buildAnimatedObjects(caseArchive(), [{ def: pumpDef, instances: [pumpInstance] }]);
      const sides = new Set<number>();
      objects[0].traverse((object) => {
        const mesh = object as { isMesh?: boolean; material?: { side: number } | { side: number }[] };
        if (mesh.isMesh && mesh.material) {
          for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            sides.add(material.side);
          }
        }
      });
      expect(sides.size).toBe(1);
      expect([...sides][0]).toBe(DoubleSide);
    });

    it('registers a mixer that nods the arm while the object is attached to the scene', () => {
      const objects = buildAnimatedObjects(caseArchive(), [{ def: pumpDef, instances: [pumpInstance] }]);
      const scene = new Group();
      scene.add(objects[0]);
      const arm = objects[0].getObjectByName('Object01') as Object3D;
      const samples: Quaternion[] = [];
      for (const step of [0, 1.3, 2.9]) {
        updateAnimatedObjects(step);
        samples.push(arm.quaternion.clone());
      }
      const moved = samples.some((sample) => Math.abs(sample.angleTo(samples[0])) > 1e-3);
      expect(moved).toBe(true);
    });

    it('pauses detached (streamed-out) objects', () => {
      const objects = buildAnimatedObjects(caseArchive(), [{ def: pumpDef, instances: [pumpInstance] }]);
      const arm = objects[0].getObjectByName('Object01') as Object3D;
      const before = arm.quaternion.clone();
      updateAnimatedObjects(1.7); // no parent — streamed out
      expect(arm.quaternion.equals(before)).toBe(true);
    });
  });
});
