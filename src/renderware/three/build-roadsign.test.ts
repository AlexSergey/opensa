import { readFileSync } from 'node:fs';
import { Texture } from 'three';
import { describe, expect, it } from 'vitest';

import type { RWRoadsign } from '../parsers/binary/types';

import { parseDff } from '../parsers/binary/dff';
import { toArrayBuffer } from '../test-utils';
import { buildRoadsignParts, roadsignGlyphIndex } from './build-roadsign';

const SIGN_DFF = 'tests/custom/proper-fixes-models/vegasnroad19.dff';

function sign(partial: Partial<RWRoadsign> = {}): RWRoadsign {
  return {
    charsPerLine: 16,
    colour: 0,
    lines: ['AB_C', '__D_'],
    plateSize: [5.6, 2.7],
    position: [10, 20, 5],
    rotation: [0, 0, 0],
    ...partial,
  };
}

describe('roadsignGlyphIndex', () => {
  describe('negative cases', () => {
    it('draws nothing for the space glyph and unknown characters', () => {
      expect(roadsignGlyphIndex('_')).toBeNull();
      expect(roadsignGlyphIndex(' ')).toBeNull();
      expect(roadsignGlyphIndex('@')).toBeNull(); // not in the atlas
    });
  });

  describe('positive cases', () => {
    it('maps direct glyphs in atlas reading order', () => {
      expect(roadsignGlyphIndex('!')).toBe(0);
      expect(roadsignGlyphIndex('0')).toBe(11);
      expect(roadsignGlyphIndex('A')).toBe(24);
      expect(roadsignGlyphIndex('a')).toBe(53);
    });

    it('maps the command characters onto the appended symbol cells', () => {
      expect(roadsignGlyphIndex('<')).toBe(82); // ←
      expect(roadsignGlyphIndex('>')).toBe(83); // →
      expect(roadsignGlyphIndex('^')).toBe(84); // ↑
      expect(roadsignGlyphIndex('}')).toBe(94); // airplane
      expect(roadsignGlyphIndex('~')).toBe(85); // ↓ (lane indicators; vanilla-verified)
    });
  });
});

describe('buildRoadsignParts', () => {
  describe('negative cases', () => {
    it('builds nothing for an empty sign list', () => {
      expect(buildRoadsignParts([], new Texture())).toEqual([]);
    });

    it('builds nothing when the text is all spaces', () => {
      expect(buildRoadsignParts([sign({ lines: ['____', '____'] })], new Texture())).toEqual([]);
    });
  });

  describe('positive cases', () => {
    it('emits a quad PER SIDE per drawn glyph with UVs inside the atlas', () => {
      const font = new Texture();
      const parts = buildRoadsignParts([sign()], font); // AB_C + __D_ = 4 glyphs
      expect(parts).toHaveLength(1);
      const geometry = parts[0].geometry;
      expect(geometry.getAttribute('position').count).toBe(4 * 2 * 4); // 4 glyphs × 2 sides × 4 corners
      expect(geometry.getIndex()?.count).toBe(4 * 2 * 6);
      const uv = geometry.getAttribute('uv');
      for (let i = 0; i < uv.count; i += 1) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getX(i)).toBeLessThanOrEqual(1);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(0);
        expect(uv.getY(i)).toBeLessThanOrEqual(1);
      }
      expect(parts[0].material.map).toBe(font);
      expect(parts[0].material.transparent).toBe(true);
    });

    it('keeps quads inside the plate, offset around the entry position', () => {
      const parts = buildRoadsignParts([sign()], new Texture());
      const position = parts[0].geometry.getAttribute('position');
      for (let i = 0; i < position.count; i += 1) {
        expect(Math.abs(position.getX(i) - 10)).toBeLessThanOrEqual(5.6 / 2 + 0.001);
        expect(Math.abs(position.getZ(i) - 5)).toBeLessThanOrEqual(2.7 / 2 + 0.001);
      }
    });

    it('batches signs by text colour (palette material per batch)', () => {
      const parts = buildRoadsignParts([sign(), sign({ position: [0, 0, 0] }), sign({ colour: 3 })], new Texture());
      expect(parts).toHaveLength(2); // two white signs merged + one red
      const red = parts.find((part) => part.material.color.getHex() === 0xb01010);
      expect(red).toBeDefined();
    });
  });
});

describe('roadsign world-space placement (real asset)', () => {
  describe('positive cases', () => {
    it('keeps the quads at the entry world coordinates — never offset by the instance placement', () => {
      // The 2dfx roadsign entries are baked in WORLD space (the Vegas junction at ~(1785..1809,
      // 1933..1937)), while the host road chunk is placed at (1797, 1943) — adding the placement
      // would throw the text off the map, which is exactly the bug this guards against.
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(SIGN_DFF))));
      const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
      const parts = buildRoadsignParts(roadsigns, new Texture());
      expect(parts.length).toBeGreaterThan(0);
      for (const part of parts) {
        const position = part.geometry.getAttribute('position');
        for (let i = 0; i < position.count; i += 1) {
          expect(position.getX(i)).toBeGreaterThan(1780);
          expect(position.getX(i)).toBeLessThan(1815);
          expect(position.getY(i)).toBeGreaterThan(1925);
          expect(position.getY(i)).toBeLessThan(1945);
        }
      }
    });

    it('parses + builds the four Vegas plates into glyph quads', () => {
      const clump = parseDff(toArrayBuffer(new Uint8Array(readFileSync(SIGN_DFF))));
      const roadsigns = clump.geometries.flatMap((geometry) => geometry.roadsigns ?? []);
      const parts = buildRoadsignParts(roadsigns, new Texture());
      const quadCorners = parts.reduce((sum, part) => sum + part.geometry.getAttribute('position').count, 0);
      expect(quadCorners).toBeGreaterThan(4 * 20); // 4 plates × a sentence of glyphs each
    });
  });
});
