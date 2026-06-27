import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import type { Impostor } from '../../core';

import { encodeLodDff } from './encode-dff';

const TEMPLATE = 'tests/original/dff/lod-template/lodroadscoast02.dff';
const template = (): Uint8Array => new Uint8Array(readFileSync(TEMPLATE));
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function binMeshPrim(dff: Uint8Array): number {
  const ext = collectGeometries(readRw(dff).chunks)[0].children?.find((c) => c.type === 0x03);
  const binMesh = ext?.children?.find((c) => c.type === 0x50e);

  return new DataView(binMesh!.data!.buffer, binMesh!.data!.byteOffset).getUint32(0, true);
}

function geomExtTypes(dff: Uint8Array): number[] {
  const geometry = collectGeometries(readRw(dff).chunks)[0];

  return (geometry.children?.find((c) => c.type === 0x03)?.children ?? []).map((c) => c.type);
}

function geomFlags(dff: Uint8Array): number {
  const struct = collectGeometries(readRw(dff).chunks)[0].children?.find((c) => c.type === 0x01);

  return new DataView(struct!.data!.buffer, struct!.data!.byteOffset).getUint16(0, true);
}

/** A baked impostor with two crossed cards (the minimal cage). */
function impostor(): Impostor {
  const card = (angle: number): Impostor['cards'][number] => ({
    angle,
    uvRect: { h: 64, w: 64, x: 0, y: 0 },
    worldU: [-5, 5],
    worldZ: [0, 20],
  });

  return {
    bbox: { max: [5, 5, 20], min: [-5, -5, 0] },
    cards: [card(0), card(Math.PI / 2)],
    height: 64,
    image: new Uint8Array(0),
    name: 'lodtest',
    width: 64,
  };
}

describe('encodeLodDff', () => {
  describe('positive cases', () => {
    it('clears the template tristrip flag (the BinMesh is a triangle list)', () => {
      expect(geomFlags(template()) & 0x01).toBe(0x01); // template precondition
      expect(geomFlags(encodeLodDff(template(), impostor())) & 0x01).toBe(0);
      expect(binMeshPrim(encodeLodDff(template(), impostor()))).toBe(0);
    });

    it('drops the template extra-vertex-colour extension', () => {
      expect(geomExtTypes(template())).toContain(0x253f2f9); // template precondition
      expect(geomExtTypes(encodeLodDff(template(), impostor()))).not.toContain(0x253f2f9);
    });

    it('names the material texture after the impostor', () => {
      const dff = parseDff(ab(encodeLodDff(template(), impostor())));

      expect(dff.geometries[0].materials[0].texture?.name).toBe('lodtest');
    });

    it('builds one double-sided quad per card (2 cards → 8 verts)', () => {
      const dff = parseDff(ab(encodeLodDff(template(), impostor())));

      expect(dff.geometries[0].positions.length / 3).toBe(8);
    });
  });
});
