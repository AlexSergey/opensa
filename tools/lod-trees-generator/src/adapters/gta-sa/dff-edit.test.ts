import { parseDff } from '@opensa/renderware/parsers/binary/dff';
import { readRw } from '@opensa/rw-codec/chunk';
import { collectGeometries } from '@opensa/rw-codec/dff';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { clearTristripFlag, setTextureName, stripExtraVertColour } from './dff-edit';

// A stock vegetation LOD DFF (the encoder's template): tristrip flag set + an extra-vertex-colour extension.
const TEMPLATE = 'tests/original/dff/lod-template/lodroadscoast02.dff';
const template = (): Uint8Array => new Uint8Array(readFileSync(TEMPLATE));
const ab = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** The child chunk types of the geometry's Extension. */
function geomExtTypes(dff: Uint8Array): number[] {
  const geometry = collectGeometries(readRw(dff).chunks)[0];

  return (geometry.children?.find((c) => c.type === 0x03)?.children ?? []).map((c) => c.type);
}

/** The geometry Struct's flags (u16 at offset 0 of the Struct body). */
function geomFlags(dff: Uint8Array): number {
  const geometry = collectGeometries(readRw(dff).chunks)[0];
  const struct = geometry.children?.find((c) => c.type === 0x01);

  return new DataView(struct!.data!.buffer, struct!.data!.byteOffset).getUint16(0, true);
}

function textureNames(dff: Uint8Array): string[] {
  const names: string[] = [];
  for (const material of parseDff(ab(dff)).geometries[0].materials) {
    if (material.texture?.name) {
      names.push(material.texture.name);
    }
  }

  return names;
}

describe('clearTristripFlag', () => {
  describe('negative cases', () => {
    it('leaves a DFF whose tristrip flag is already clear unchanged', () => {
      const once = clearTristripFlag(template());

      expect(geomFlags(clearTristripFlag(once)) & 0x01).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('clears the tristrip bit (the template has it set)', () => {
      expect(geomFlags(template()) & 0x01).toBe(0x01);
      expect(geomFlags(clearTristripFlag(template())) & 0x01).toBe(0);
    });

    it('preserves every other geometry flag', () => {
      const before = geomFlags(template());

      expect(geomFlags(clearTristripFlag(template()))).toBe(before & ~0x01);
    });
  });
});

describe('stripExtraVertColour', () => {
  describe('negative cases', () => {
    it('leaves a DFF without the extension unchanged', () => {
      const stripped = stripExtraVertColour(template());

      expect(geomExtTypes(stripExtraVertColour(stripped))).not.toContain(0x253f2f9);
    });
  });

  describe('positive cases', () => {
    it('removes the extra-vertex-colour extension (the template has it)', () => {
      expect(geomExtTypes(template())).toContain(0x253f2f9);
      expect(geomExtTypes(stripExtraVertColour(template()))).not.toContain(0x253f2f9);
    });

    it('keeps the BinMesh extension and the DFF still parses', () => {
      const out = stripExtraVertColour(template());

      expect(geomExtTypes(out)).toContain(0x50e);
      expect(parseDff(ab(out)).geometries).toHaveLength(1);
    });
  });
});

describe('setTextureName', () => {
  describe('positive cases', () => {
    it('renames every material texture to the given name', () => {
      const out = setTextureName(template(), 'lodtest');

      expect(textureNames(out).every((name) => name === 'lodtest')).toBe(true);
      expect(textureNames(out).length).toBeGreaterThan(0);
    });
  });
});
