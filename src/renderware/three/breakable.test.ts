import { readFileSync } from 'node:fs';
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';

import type { RWBreakable } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import {
  breakableFromGeometry,
  type BreakableInstance,
  breakableInstanceKey,
  breakBreakable,
  getBreakableByKey,
  nearestBreakable,
  registerBreakable,
  resetBreakables,
} from './breakable';
import { debrisTimeUniform, resetDebris } from './build-debris';

const BIN_DFF = 'tests/original/dff/breakable/binnt08_la.dff';

function binBreakable(): RWBreakable {
  const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(BIN_DFF))));

  return clump.geometries.find((geometry) => geometry.breakable)!.breakable!;
}

/** A registered bin at a world position, with two part meshes (one instance) parented to `parent`. */
function placeBin(parent: Group, position: [number, number, number]): BreakableInstance {
  const meshes = [0, 1].map(() => {
    const mesh = new InstancedMesh(new BoxGeometry(), new MeshBasicMaterial(), 1);
    mesh.setMatrixAt(0, new Matrix4());
    parent.add(mesh);

    return mesh;
  });
  registerBreakable({
    breakable: binBreakable(),
    key: breakableInstanceKey('binnt08_la', position),
    meshes,
    modelName: 'binnt08_la',
    position,
    slot: 0,
    transform: new Matrix4().makeTranslation(...position),
  });

  return nearestBreakable(position, 0.1)!;
}

describe('breakableFromGeometry (render-mesh fallback for atomic-less smash props)', () => {
  it('maps a render geometry to a shatter mesh (counts, lowercased texture)', () => {
    const geometry = parseDff(toArrayBuffer(new Uint8Array(readFileSync(BIN_DFF)))).geometries[0];
    const shatter = breakableFromGeometry(geometry);

    expect(shatter.triangleMaterials).toHaveLength(geometry.triangles.length);
    expect(shatter.triangles).toHaveLength(geometry.triangles.length * 3);
    expect(shatter.positions).toBe(geometry.positions); // shared, not copied
    expect(shatter.materials).toHaveLength(geometry.materials.length);
    for (const material of shatter.materials) {
      expect(material.texture).toBe(material.texture.toLowerCase());
      expect(material.ambient).toEqual([1, 1, 1]); // prelit carries the shading
    }
  });
});

describe('breakable registry', () => {
  beforeEach(() => {
    resetBreakables();
    resetDebris();
    debrisTimeUniform.value = 0;
  });

  describe('negative cases', () => {
    it('finds nothing beyond the search radius', () => {
      const parent = new Group();
      placeBin(parent, [0, 0, 0]);
      expect(nearestBreakable([100, 0, 0], 10)).toBeUndefined();
    });

    it('skips an already-broken prop and refuses to break it twice', () => {
      const parent = new Group();
      placeBin(parent, [5, 5, 0]);
      const entry = nearestBreakable([5, 5, 0], 1)!;
      expect(breakBreakable(entry, parent)).toBe(true);
      expect(breakBreakable(entry, parent)).toBe(false); // already broken
      expect(nearestBreakable([5, 5, 0], 1)).toBeUndefined(); // not returned once broken
    });

    it('skips a prop whose cell streamed out (meshes detached)', () => {
      const parent = new Group();
      placeBin(parent, [1, 1, 0]);
      parent.clear(); // streamed out — part meshes detached
      expect(nearestBreakable([1, 1, 0], 1)).toBeUndefined();
    });

    it('ignores a prop outside the vertical limit (a prop on another floor)', () => {
      const parent = new Group();
      placeBin(parent, [0, 0, 5]); // 5 m up
      expect(nearestBreakable([0, 0, 0], 1, 3)).toBeUndefined();
    });
  });

  describe('positive cases', () => {
    it('returns the nearest un-broken prop within the radius', () => {
      const parent = new Group();
      placeBin(parent, [0, 0, 0]);
      placeBin(parent, [3, 0, 0]);
      expect(nearestBreakable([2.6, 0, 0], 5)?.position).toEqual([3, 0, 0]);
    });

    it('matches on planar distance so a chassis-above-base Z gap fits a tight radius', () => {
      const parent = new Group();
      placeBin(parent, [0, 0, 0]); // base at z = 0
      // Bumper 0.5 m ahead and 0.7 m up (chassis centre): 3D dist ≈ 0.86 but planar 0.5 ≤ 1.0.
      expect(nearestBreakable([0.5, 0, 0.7], 1, 3)?.position).toEqual([0, 0, 0]);
    });

    it('collapses the prop slots and spawns one debris mesh on break', () => {
      const parent = new Group();
      const entry = placeBin(parent, [0, 0, 0]);
      const before = parent.children.length;
      expect(breakBreakable(entry, parent, { impact: [10, 0, 0] })).toBe(true);

      // The prop's two part meshes collapse to zero scale (diagonal basis all 0 → invisible).
      const matrix = new Matrix4();
      for (const mesh of entry.meshes) {
        mesh.getMatrixAt(0, matrix);
        expect([matrix.elements[0], matrix.elements[5], matrix.elements[10]]).toEqual([0, 0, 0]);
      }
      // Exactly one debris mesh was added under the parent.
      expect(parent.children.length).toBe(before + 1);
      expect(parent.children.some((child) => child.name === 'debris')).toBe(true);
    });

    it('resolves a prop by its instance key, and not once broken (contact-impact path)', () => {
      const parent = new Group();
      const entry = placeBin(parent, [4, 4, 0]);
      expect(getBreakableByKey(entry.key)).toBe(entry);
      breakBreakable(entry, parent);
      expect(getBreakableByKey(entry.key)).toBeUndefined();
    });

    it('replaces a stale entry on re-registration with the same key (cell rebuild)', () => {
      const parent = new Group();
      placeBin(parent, [7, 0, 0]);
      const reparent = new Group();
      const fresh = placeBin(reparent, [7, 0, 0]); // same key, new meshes under a live parent
      expect(nearestBreakable([7, 0, 0], 1)).toBe(fresh);
      expect(breakBreakable(fresh, reparent)).toBe(true);
    });
  });
});
