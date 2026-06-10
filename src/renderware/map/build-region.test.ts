import { readFileSync } from 'node:fs';

import type { MeshStandardMaterial } from 'three';

import { DoubleSide, FrontSide } from 'three';
import { describe, expect, it } from 'vitest';

import type { IdeObjectDef, IplInstance } from '../parsers/text';

import { buildArchiveBuffer, openArchive } from '../archive';
import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildInstancedMeshes } from './build-region';

// Real regression case: the gta3-pf.img re-export of trafficlight1 ships NO stored normals and
// mixed face winding, so front-side culling dropped half its housing. SA renders it whole because
// its IDE def (dynamic.ide: `1315, trafficlight1, dyntraffic, 80, 2130048`) carries flag 0x200000 =
// disable backface culling — which buildInstancedMeshes must honour.
const CASE_DIR = 'tests/dff/trafficlight-backface-culling';
const TRAFFICLIGHT_IDE_FLAGS = 2130048;

/** SA IDE flag 0x200000 — disable backface culling (see build-region). */
const DISABLE_BACKFACE_CULLING = 0x200000;

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

function sides(flags: number): number[] {
  const meshes = buildInstancedMeshes(caseArchive(), [{ def: def(flags), instances: [instance] }]);

  return meshes.map((mesh) => (mesh.material as MeshStandardMaterial).side);
}

describe('buildInstancedMeshes (trafficlight1 backface-culling case)', () => {
  describe('negative cases', () => {
    it('keeps default front-side culling when the def lacks the IDE flag', () => {
      const result = sides(TRAFFICLIGHT_IDE_FLAGS & ~DISABLE_BACKFACE_CULLING);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((side) => side === FrontSide)).toBe(true);
    });
  });

  describe('positive cases', () => {
    it('confirms the re-export stores no normals (why culling needs the flag)', () => {
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(`${CASE_DIR}/trafficlight1.dff`))));
      expect(clump.geometries.length).toBeGreaterThan(0);
      expect(clump.geometries.every((geometry) => geometry.normals === null)).toBe(true);
    });

    it('renders the def double-sided with its real dynamic.ide flags', () => {
      const result = sides(TRAFFICLIGHT_IDE_FLAGS);
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((side) => side === DoubleSide)).toBe(true);
    });
  });
});
