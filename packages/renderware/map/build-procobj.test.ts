import type { InstancedMesh } from 'three';

import { readFileSync } from 'node:fs';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { IdeObjectDef } from '../parsers/text';
import type { ProcObjBatch } from './procobj-scatter';

import { buildArchiveBuffer, openArchive } from '../archive';
import { buildProcObjMeshes } from './build-procobj';
import { resetProcObjMeshes, updateProcObjMeshes } from './procobj-runtime';

// Stand-in clutter model: a real DFF+TXD fixture already in the repo (the archive path and
// world-material build are identical for actual clutter like sand_combush02).
const CASE_DIR = 'tests/original/dff/trafficlight-backface-culling'; // dyntraffic.txd (stock, regenerated)
const TRAFFICLIGHT_DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff'; // proper-fixes re-export (committed)

const def: IdeObjectDef = { drawDistance: 80, flags: 0, id: 1315, modelName: 'trafficlight1', txdName: 'dyntraffic' };

function batch(partial: Partial<ProcObjBatch> = {}): ProcObjBatch {
  return {
    category: 'bushes',
    model: 'trafficlight1',
    placements: [
      {
        align: false,
        lottery: 0.5,
        normal: [0, 0, 1],
        position: [10, 20, 5],
        rotation: Math.PI / 2,
        scale: 2,
        scaleZ: 0.5,
      },
      {
        align: true,
        lottery: 2.5,
        normal: [1, 0, 0],
        position: [-5, 0, 1],
        rotation: 0,
        scale: 1,
        scaleZ: 1,
      },
    ],
    ...partial,
  };
}

function caseArchive(): ReturnType<typeof openArchive> {
  return openArchive(
    buildArchiveBuffer([
      { data: readFileSync(TRAFFICLIGHT_DFF), name: 'trafficlight1.dff' },
      { data: readFileSync(`${CASE_DIR}/dyntraffic.txd`), name: 'dyntraffic.txd' },
    ]),
  );
}

beforeEach(() => {
  resetProcObjMeshes();
});

describe('buildProcObjMeshes', () => {
  describe('negative cases', () => {
    it('skips batches whose model has no catalog def', () => {
      const meshes = buildProcObjMeshes(caseArchive(), [batch()], () => undefined);
      expect(meshes).toEqual([]);
    });

    it('skips empty batches', () => {
      const meshes = buildProcObjMeshes(caseArchive(), [batch({ placements: [] })], () => def);
      expect(meshes).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('builds invisible instanced meshes with the placement transforms applied', () => {
      const meshes = buildProcObjMeshes(caseArchive(), [batch()], () => def) as InstancedMesh[];
      expect(meshes.length).toBeGreaterThan(0);
      const matrix = new Matrix4();
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      for (const mesh of meshes) {
        expect(mesh.visible).toBe(false); // until the runtime settings pass enables it
        expect(mesh.castShadow).toBe(false);
        expect(mesh.userData.procObj).toEqual({ category: 'bushes', model: 'trafficlight1' });
        mesh.getMatrixAt(0, matrix);
        matrix.decompose(position, quaternion, scale);
        expect([position.x, position.y, position.z]).toEqual([10, 20, 5]);
        expect(scale.x).toBeCloseTo(2, 5);
        expect(scale.y).toBeCloseTo(2, 5);
        expect(scale.z).toBeCloseTo(0.5, 5);
      }
    });

    it('aligned placements tilt the model up-axis onto the face normal', () => {
      const meshes = buildProcObjMeshes(caseArchive(), [batch()], () => def) as InstancedMesh[];
      const matrix = new Matrix4();
      const position = new Vector3();
      const quaternion = new Quaternion();
      const scale = new Vector3();
      meshes[0].getMatrixAt(1, matrix);
      matrix.decompose(position, quaternion, scale);
      const up = new Vector3(0, 0, 1).applyQuaternion(quaternion);
      expect(up.x).toBeCloseTo(1, 5); // model up now points along the +X face normal
      expect(up.z).toBeCloseTo(0, 5);
    });

    it('registers with the runtime — the settings pass drives visibility and density count', () => {
      const meshes = buildProcObjMeshes(caseArchive(), [batch()], () => def) as InstancedMesh[];
      const settings = {
        bushes: { density: 1, drawDistance: 1000, enabled: true },
        cacti: { density: 1, drawDistance: 100, enabled: true },
        flowers: { density: 1, drawDistance: 100, enabled: true },
        grass: { density: 1, drawDistance: 100, enabled: true },
        rocks: { density: 1, drawDistance: 100, enabled: true },
        trees: { density: 1, drawDistance: 100, enabled: true },
        underwater: { density: 1, drawDistance: 100, enabled: true },
      };
      // Detached → untouched; attach and update → visible with the density-1 cutoff (1 of 2).
      updateProcObjMeshes([0, 0, 0], settings);
      expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
      const root = new Group();
      meshes.forEach((mesh) => root.add(mesh));
      updateProcObjMeshes([0, 0, 0], settings);
      for (const mesh of meshes) {
        expect(mesh.visible).toBe(true);
        expect(mesh.count).toBe(1); // lotteries [0.5, 2.5], density 1
      }
    });
  });
});
