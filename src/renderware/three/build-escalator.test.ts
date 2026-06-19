import { existsSync, readFileSync } from 'node:fs';
import { Group, type InstancedMesh, Matrix4, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildClumpEscalators, buildClumpParts } from './build-clump';
import { buildEscalatorSteps, type EscalatorPathEntry, resetEscalators, updateEscalators } from './build-escalator';

// Real assets: the LA mall escalator pair (path source) + the vanilla step model SA instances.
const HOST_DFF = 'tests/original/dff/escalator/escl_la.dff';
const STEP_DFF = 'tests/original/dff/escalator/esc_step.dff';
const assetsExist = existsSync(HOST_DFF) && existsSync(STEP_DFF);

/** The host model's two escalators as world entries (identity placement is fine for the rig math). */
function hostEntries(): EscalatorPathEntry[] {
  return buildClumpEscalators(load(HOST_DFF)).map((escalator) => ({
    direction: escalator.direction,
    points: escalator.points,
  }));
}

function load(path: string): ReturnType<typeof parseDff> {
  return parseDff(toArrayBuffer(new Uint8Array(readFileSync(path))));
}

describe('buildEscalatorSteps', () => {
  beforeEach(() => {
    resetEscalators();
  });

  describe('negative cases', () => {
    it('builds nothing for empty parts or empty entries', () => {
      expect(buildEscalatorSteps([], [])).toEqual([]);
      if (assetsExist) {
        const parts = buildClumpParts(load(STEP_DFF));
        expect(buildEscalatorSteps(parts, [])).toEqual([]);
      }
    });

    it.skipIf(!assetsExist)('skips degenerate paths (coincident points)', () => {
      const parts = buildClumpParts(load(STEP_DFF));
      const point: [number, number, number] = [1, 2, 3];
      expect(buildEscalatorSteps(parts, [{ direction: 1, points: [point, point, point, point] }])).toEqual([]);
    });

    it.skipIf(!assetsExist)('does not advance detached rigs', () => {
      const parts = buildClumpParts(load(STEP_DFF));
      const [mesh] = buildEscalatorSteps(parts, hostEntries()) as InstancedMesh[];
      const before = new Matrix4();
      mesh.getMatrixAt(0, before);
      updateEscalators(10); // no parent — streamed out
      const after = new Matrix4();
      mesh.getMatrixAt(0, after);
      expect(after.equals(before)).toBe(true);
    });
  });

  describe.skipIf(!assetsExist)('positive cases (real escl_la + esc_step)', () => {
    it('builds one looping step row per escalator, riding the path', () => {
      const parts = buildClumpParts(load(STEP_DFF));
      const entries = hostEntries();
      expect(entries).toHaveLength(2);
      const meshes = buildEscalatorSteps(parts, entries) as InstancedMesh[];
      // One InstancedMesh per (escalator, step part).
      expect(meshes.length).toBe(2 * parts.length);

      const root = new Group();
      for (const mesh of meshes) {
        root.add(mesh);
      }
      updateEscalators(0);

      // The LA path is ~15 m — a real row of steps, all inside the path bounds (with step size slack).
      const mesh = meshes[0];
      expect(mesh.count).toBeGreaterThan(10);
      const position = new Vector3();
      const matrix = new Matrix4();
      const zs: number[] = [];
      for (let i = 0; i < mesh.count; i += 1) {
        mesh.getMatrixAt(i, matrix);
        position.setFromMatrixPosition(matrix);
        expect(Math.abs(position.x)).toBeLessThan(3);
        expect(Math.abs(position.y)).toBeLessThan(8);
        zs.push(position.z);
      }
      // Steps span the incline: both low-landing and high-landing heights are populated.
      expect(Math.min(...zs)).toBeLessThan(-2);
      expect(Math.max(...zs)).toBeGreaterThan(2);
    });

    it('moves attached steps over time and keeps them on the path loop', () => {
      const parts = buildClumpParts(load(STEP_DFF));
      const meshes = buildEscalatorSteps(parts, hostEntries()) as InstancedMesh[];
      const root = new Group();
      for (const mesh of meshes) {
        root.add(mesh);
      }

      const matrix = new Matrix4();
      updateEscalators(0);
      const before = new Vector3();
      meshes[0].getMatrixAt(0, matrix);
      before.setFromMatrixPosition(matrix);

      updateEscalators(2);
      const after = new Vector3();
      meshes[0].getMatrixAt(0, matrix);
      after.setFromMatrixPosition(matrix);

      expect(after.distanceTo(before)).toBeGreaterThan(0.5); // ~0.45 m/s for 2 s
      expect(Math.abs(after.y)).toBeLessThan(8); // still on the path
    });
  });
});
