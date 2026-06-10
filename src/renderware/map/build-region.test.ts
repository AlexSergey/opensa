import type { MeshBasicMaterial } from 'three';

import { readFileSync } from 'node:fs';
import { AdditiveBlending, DoubleSide, FrontSide, NormalBlending } from 'three';
import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance } from '../parsers/text';

import { buildArchiveBuffer, openArchive } from '../archive';
import { parseDff } from '../parsers/binary/dff';
import { IdeFlag } from '../parsers/text';
import { toArrayBuffer } from '../test-utils';
import { buildInstancedMeshes } from './build-region';

// Real regression case: the gta3-pf.img re-export of trafficlight1 ships NO stored normals and
// mixed face winding, so front-side culling dropped half its housing. SA renders it whole because
// its IDE def (dynamic.ide: `1315, trafficlight1, dyntraffic, 80, 2130048`) carries flag 0x200000 =
// disable backface culling — which buildInstancedMeshes must honour.
const CASE_DIR = 'tests/dff/trafficlight-backface-culling';
const TRAFFICLIGHT_IDE_FLAGS = 2130048;

function caseArchive(): ReturnType<typeof openArchive> {
  return openArchive(
    buildArchiveBuffer([
      { data: readFileSync(`${CASE_DIR}/trafficlight1.dff`), name: 'trafficlight1.dff' },
      { data: readFileSync(`${CASE_DIR}/dyntraffic.txd`), name: 'dyntraffic.txd' },
    ]),
  );
}

function def(flags: number): IdeObjectDef {
  return { drawDistance: 80, flags, id: 1315, modelName: 'trafficlight1', txdName: 'dyntraffic' };
}

const instance: IplInstance = {
  id: 1315,
  interior: 0,
  lod: -1,
  modelName: '',
  position: [2350.2, -1664.7, 15.8],
  rotation: [0, 0, 0, 1],
};

function materials(
  flags: number,
): { material: MeshBasicMaterial; mesh: ReturnType<typeof buildInstancedMeshes>[number] }[] {
  return buildInstancedMeshes(caseArchive(), [{ def: def(flags), instances: [instance] }]).map((mesh) => ({
    material: mesh.material as MeshBasicMaterial,
    mesh,
  }));
}

describe('buildInstancedMeshes (trafficlight1 backface-culling case)', () => {
  describe('negative cases', () => {
    it('keeps default front-side culling when the def lacks the IDE flag', () => {
      const built = materials(TRAFFICLIGHT_IDE_FLAGS & ~IdeFlag.DISABLE_BACKFACE_CULLING);
      expect(built.length).toBeGreaterThan(0);
      expect(built.every(({ material }) => material.side === FrontSide)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('confirms the re-export stores no normals (why culling needs the flag)', () => {
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(`${CASE_DIR}/trafficlight1.dff`))));
      expect(clump.geometries.length).toBeGreaterThan(0);
      expect(clump.geometries.every((geometry) => geometry.normals === null)).toBe(true);
    });

    it('renders the def double-sided with its real dynamic.ide flags', () => {
      const built = materials(TRAFFICLIGHT_IDE_FLAGS);
      expect(built.length).toBeGreaterThan(0);
      expect(built.every(({ material }) => material.side === DoubleSide)).toBe(true);
    });

    it('builds the unlit SA world material with shadows fully off (plan 038)', () => {
      const built = materials(TRAFFICLIGHT_IDE_FLAGS);
      expect(built.length).toBeGreaterThan(0);
      for (const { material, mesh } of built) {
        expect(material.isMeshBasicMaterial).toBe(true); // unlit — normals/sun never touch the map
        expect(material.customProgramCacheKey()).toContain('saWorld');
        expect(mesh.castShadow).toBe(false); // only dynamics cast
        expect(mesh.receiveShadow).toBe(false); // the world material samples the shadow map manually
      }
    });
  });
});

describe('buildInstancedMeshes (SA IDE render flags, plan 039)', () => {
  describe('negative cases', () => {
    it('keeps opaque depth-writing defaults when no render flags are set', () => {
      const built = materials(0);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.transparent).toBe(false);
        expect(material.depthWrite).toBe(true);
        expect(material.blending).toBe(NormalBlending);
      }
    });
  });

  describe('positive cases', () => {
    it('DRAW_LAST moves the parts into the sorted alpha list', () => {
      const built = materials(IdeFlag.DRAW_LAST);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(true); // sorted, but still occludes
      }
    });

    it('NO_ZBUFFER_WRITE stops the parts writing depth (ground decals)', () => {
      const built = materials(IdeFlag.NO_ZBUFFER_WRITE);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.depthWrite).toBe(false);
      }
    });

    it('ADDITIVE implies sorted + no depth write + additive blending', () => {
      const built = materials(IdeFlag.ADDITIVE);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.blending).toBe(AdditiveBlending);
        expect(material.transparent).toBe(true);
        expect(material.depthWrite).toBe(false);
        expect(material.alphaTest).toBe(0);
      }
    });

    it('runs the mod decoratePart hook once per part, after the vanilla treatment', () => {
      const seen: { flags: number; model: string; transparent: boolean }[] = [];
      const meshes = buildInstancedMeshes(caseArchive(), [{ def: def(IdeFlag.DRAW_LAST), instances: [instance] }], {
        decoratePart: (partDef, part) => {
          // DRAW_LAST already applied → the hook observes the post-treatment material.
          seen.push({ flags: partDef.flags, model: partDef.modelName, transparent: part.material.transparent });
        },
      });
      expect(seen).toHaveLength(meshes.length);
      for (const call of seen) {
        expect(call.model).toBe('trafficlight1');
        expect(call.flags).toBe(IdeFlag.DRAW_LAST);
        expect(call.transparent).toBe(true);
      }
    });
  });
});
