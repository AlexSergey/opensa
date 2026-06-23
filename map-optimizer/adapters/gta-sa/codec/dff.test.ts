import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseDff } from '../../../../src/renderware/parsers/binary/dff';
import { clumpToIr } from '../read';
import { readRw, writeRw } from './chunk';
import { encodeDff } from './dff';

// Committed mod fixtures (tests/custom is tracked); both are full skinned RenderWare clumps.
const FIXTURES = ['tests/custom/character/gostown-bmypol1.dff', 'tests/custom/character/Shrek.dff'];

function equal(a: Uint8Array, b: Uint8Array): boolean {
  return Buffer.from(a).equals(Buffer.from(b));
}

function load(path: string): { arrayBuffer: ArrayBuffer; bytes: Uint8Array } {
  const buffer = readFileSync(path);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);

  return { arrayBuffer, bytes: new Uint8Array(arrayBuffer) };
}

describe('readRw / writeRw (chunk container)', () => {
  describe('positive cases', () => {
    for (const path of FIXTURES) {
      it(`round-trips ${path.split('/').pop()} byte-for-byte`, () => {
        const { bytes } = load(path);
        expect(equal(writeRw(readRw(bytes)), bytes)).toBe(true);
      });
    }
  });
});

describe('encodeDff', () => {
  describe('negative cases', () => {
    it('throws when the IR geometry count no longer matches the DFF', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      ir.meshes.push(ir.meshes[0]); // simulate a topology/structure change the in-place patcher can't express

      expect(() => encodeDff(bytes, ir)).toThrow(/geometry count mismatch/);
    });

    it('throws when a sub-mesh vertex count changed (topology edit)', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      ir.meshes[0].positions = ir.meshes[0].positions.slice(0, -3); // drop a vertex

      expect(() => encodeDff(bytes, ir)).toThrow(/topology change unsupported/);
    });
  });

  describe('positive cases', () => {
    for (const path of FIXTURES) {
      it(`re-encodes an unchanged ${path.split('/').pop()} identically`, () => {
        const { arrayBuffer, bytes } = load(path);
        const ir = clumpToIr(parseDff(arrayBuffer));
        expect(equal(encodeDff(bytes, ir), bytes)).toBe(true);
      });
    }

    it('writes back a modified normal (topology preserved)', () => {
      const { arrayBuffer, bytes } = load(FIXTURES[0]);
      const ir = clumpToIr(parseDff(arrayBuffer));
      const mesh = ir.meshes.find((candidate) => candidate.normals);
      expect(mesh?.normals).toBeTruthy();
      const normals = mesh!.normals!;
      const before = normals[0];
      normals[0] = before + 0.5;

      const encoded = encodeDff(bytes, ir);
      const reparsed = clumpToIr(parseDff(encoded.buffer as ArrayBuffer));
      const sameMesh = reparsed.meshes.find((candidate) => candidate.name === mesh!.name)!;

      expect(equal(encoded, bytes)).toBe(false);
      expect(sameMesh.normals![0]).toBeCloseTo(before + 0.5, 5);
      expect(sameMesh.positions.length).toBe(mesh!.positions.length);
    });
  });
});
