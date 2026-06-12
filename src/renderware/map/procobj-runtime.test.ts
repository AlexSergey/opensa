import { BoxGeometry, Group, InstancedMesh, MeshBasicMaterial, Sphere, Vector3 } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { ProcObjCategoryName } from './procobj-categories';
import type { ProcObjSettings } from './procobj-runtime';

import { registerProcObjMesh, resetProcObjMeshes, updateProcObjMeshes } from './procobj-runtime';

function allSettings(patch: Partial<ProcObjSettings> = {}): Record<ProcObjCategoryName, ProcObjSettings> {
  const setting: ProcObjSettings = { density: 1, drawDistance: 100, enabled: true, ...patch };

  return {
    bushes: setting,
    cacti: setting,
    flowers: setting,
    grass: setting,
    rocks: setting,
    trees: setting,
    underwater: setting,
  };
}

/** Mesh with 6 instances whose lotteries are 0.25, 0.75, 1.25, 1.75, 2.25, 2.75 (sorted). */
function clutterMesh(): InstancedMesh {
  const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 6);
  mesh.boundingSphere = new Sphere(new Vector3(0, 0, 0), 10);

  return mesh;
}

const LOTTERIES = new Float32Array([0.25, 0.75, 1.25, 1.75, 2.25, 2.75]);

beforeEach(() => {
  resetProcObjMeshes();
});

describe('updateProcObjMeshes', () => {
  describe('negative cases', () => {
    it('hides meshes of a disabled category', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'grass', LOTTERIES);
      updateProcObjMeshes([0, 0, 0], allSettings({ enabled: false }));
      expect(mesh.visible).toBe(false);
    });

    it('skips detached (streamed-out) meshes', () => {
      const mesh = clutterMesh();
      mesh.visible = false;
      registerProcObjMesh(mesh, 'grass', LOTTERIES);
      updateProcObjMeshes([0, 0, 0], allSettings());
      expect(mesh.visible).toBe(false); // untouched — no parent
    });

    it('hides meshes beyond the category draw distance (bounding sphere inclusive)', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'rocks', LOTTERIES);
      updateProcObjMeshes([200, 0, 0], allSettings({ drawDistance: 100 })); // 200 − r10 > 100
      expect(mesh.visible).toBe(false);
    });

    it('hides meshes entirely at density 0', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'grass', LOTTERIES);
      updateProcObjMeshes([0, 0, 0], allSettings({ density: 0 }));
      expect(mesh.visible).toBe(false);
    });
  });

  describe('positive cases', () => {
    it('applies the density cutoff over the sorted lotteries (vanilla 1 → a third of 3×)', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'bushes', LOTTERIES);
      updateProcObjMeshes([0, 0, 0], allSettings({ density: 1 }));
      expect(mesh.visible).toBe(true);
      expect(mesh.count).toBe(2); // lotteries 0.25, 0.75 < 1
      updateProcObjMeshes([0, 0, 0], allSettings({ density: 3 }));
      expect(mesh.count).toBe(6); // full headroom
      updateProcObjMeshes([0, 0, 0], allSettings({ density: 0.5 }));
      expect(mesh.count).toBe(1);
    });

    it('caps the cutoff at the per-cell render-budget lottery threshold', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'grass', LOTTERIES, 1.5); // budget cap below the density
      updateProcObjMeshes([0, 0, 0], allSettings({ density: 3 }));
      expect(mesh.count).toBe(3); // lotteries 0.25, 0.75, 1.25 < cap 1.5 — not all 6
    });

    it('shows meshes again when the view returns into range', () => {
      const mesh = clutterMesh();
      new Group().add(mesh);
      registerProcObjMesh(mesh, 'trees', LOTTERIES);
      updateProcObjMeshes([200, 0, 0], allSettings());
      expect(mesh.visible).toBe(false);
      updateProcObjMeshes([50, 0, 0], allSettings());
      expect(mesh.visible).toBe(true); // 50 − r10 ≤ 100
    });
  });
});
