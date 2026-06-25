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
const CASE_DIR = 'tests/original/dff/trafficlight-backface-culling'; // dyntraffic.txd (stock, regenerated)
const TRAFFICLIGHT_DFF = 'tests/custom/proper-fixes-models/trafficlight1.dff'; // proper-fixes re-export (committed)
const TRAFFICLIGHT_IDE_FLAGS = 2130048;

function caseArchive(): ReturnType<typeof openArchive> {
  return openArchive(
    buildArchiveBuffer([
      { data: readFileSync(TRAFFICLIGHT_DFF), name: 'trafficlight1.dff' },
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
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(TRAFFICLIGHT_DFF))));
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

    it('NO_ZBUFFER_WRITE on OPAQUE geometry still writes depth (terrain fix)', () => {
      // SA disables z-write for any 0x40 model, but a non-writing opaque ground tile (bare 0x40 on
      // big countryside terrain) shows through under a free camera. So opaque keeps depth writes.
      const built = materials(IdeFlag.NO_ZBUFFER_WRITE);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.transparent).toBe(false);
        expect(material.depthWrite).toBe(true);
      }
    });

    it('NO_ZBUFFER_WRITE on a transparent decal (with DRAW_LAST) drops depth writes', () => {
      // Real decals/shadows always pair 0x40 with DRAW_LAST (e.g. grnd_alpha* 2097348, trackshad 68).
      const built = materials(IdeFlag.NO_ZBUFFER_WRITE | IdeFlag.DRAW_LAST);
      expect(built.length).toBeGreaterThan(0);
      for (const { material } of built) {
        expect(material.transparent).toBe(true);
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

    it('places parts by the instance transform alone — stray DFF frame offsets are ignored', () => {
      // Real case: gta3-pf ce_grndpalcst05 ships a junk (12.9, 317, −28.5) frame translation; SA
      // re-frames map atomics to identity, so the mesh must land where its collision is.
      const archive = openArchive(
        buildArchiveBuffer([
          {
            data: readFileSync('tests/original/dff/frame-offset-ignored/ce_grndpalcst05.dff'),
            name: 'ce_grndpalcst05.dff',
          },
        ]),
      );
      const palcstDef: IdeObjectDef = {
        drawDistance: 299,
        flags: 0,
        id: 13810,
        modelName: 'CE_grndPALCST05',
        txdName: 'lahillsground4',
      };
      const palcstInstance: IplInstance = {
        id: 13810,
        interior: 0,
        lod: -1,
        modelName: '',
        position: [2948.41, -951.77, -28.52], // the real lahills.ipl placement
        rotation: [0, 0, 0, 1],
      };
      const meshes = buildInstancedMeshes(archive, [{ def: palcstDef, instances: [palcstInstance] }]);
      expect(meshes.length).toBeGreaterThan(0);
      for (const mesh of meshes) {
        const center = mesh.boundingSphere?.center;
        expect(center).toBeDefined();
        // Raw geometry is centred near local (−39, 0, +39) → world ≈ (2909, −952, 10.5). With the
        // frame offset wrongly applied it would sit ~300 units north at y ≈ −635.
        expect(center?.y).toBeGreaterThan(-1050);
        expect(center?.y).toBeLessThan(-850);
        expect(center?.z).toBeGreaterThan(5);
        expect(center?.z).toBeLessThan(15);
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
