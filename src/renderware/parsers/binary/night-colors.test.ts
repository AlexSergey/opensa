import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDff } from './dff';

// Real Ganton fixtures whose SA "extra vertex colour" / night prelit set (chunk 0x253F2F9, which our parser
// now reads) carries the baked night lighting:
//   compfukhouse3 (id 3589)  — lit windows at night: bright warm verts in its night colours.
//   mcstraps_LAe2 (id 17699) — windows stay dark: night colours are dull, no bright warm window verts.
//   Lae2_roads03             — a road whose night colours bake the street-lamp pools: mostly dark, with a
//                              few warm-moderate verts (the lit patches under lamps).
const fixtures = {
  dark: join(process.cwd(), 'tests', 'world', 'mcstraps_LAe2.dff'),
  lit: join(process.cwd(), 'tests', 'world', 'compfukhouse3.dff'),
  road: join(process.cwd(), 'tests', 'world', 'Lae2_roads03.dff'),
};
const haveFixtures = Object.values(fixtures).every((p) => existsSync(p));

function geometryOf(path: string): ReturnType<typeof parseDff>['geometries'][number] {
  return parseDff(new Uint8Array(readFileSync(path)).buffer).geometries[0];
}

/** A lit-window vertex: bright + distinctly warm (R high, well above B) — what makes windows glow at night. */
function litWindowVerts(night: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < night.length; i += 4) {
    const [r, g, b] = [night[i], night[i + 1], night[i + 2]];
    if (r > 150 && r - b > 50 && (r + g + b) / 3 > 120) {
      count += 1;
    }
  }

  return count;
}

/** Count vertices in a luminance band — used to show a road's night set is mostly dark with some lit patches. */
function vertsInLumaBand(night: Uint8Array, lo: number, hi: number): number {
  let count = 0;
  for (let i = 0; i < night.length; i += 4) {
    const luma = (night[i] + night[i + 1] + night[i + 2]) / 3;
    if (luma >= lo && luma < hi) {
      count += 1;
    }
  }

  return count;
}

describe.skipIf(!haveFixtures)('parseDff night vertex colours (0x253F2F9)', () => {
  describe('negative cases', () => {
    it('reads night colours for a house whose windows stay dark, with no bright warm window verts', () => {
      const geo = geometryOf(fixtures.dark);
      expect(geo.nightColors).not.toBeNull();
      expect(geo.nightColors!.length).toBe((geo.positions.length / 3) * 4);
      expect(litWindowVerts(geo.nightColors!)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads night colours with bright warm window verts for a house with lit windows', () => {
      const geo = geometryOf(fixtures.lit);
      expect(geo.nightColors).not.toBeNull();
      expect(geo.nightColors!.length).toBe((geo.positions.length / 3) * 4);
      expect(litWindowVerts(geo.nightColors!)).toBeGreaterThan(0);
    });

    it('exposes night colours as a separate set from the (grey) day prelit colours', () => {
      const geo = geometryOf(fixtures.lit);
      expect(geo.prelitColors).not.toBeNull();
      expect(geo.nightColors).not.toBe(geo.prelitColors); // distinct buffers — day stays grey, night lights up
    });

    it("bakes street-lamp pools into a road's night colours — mostly dark with a few lit patches", () => {
      const geo = geometryOf(fixtures.road);
      expect(geo.nightColors).not.toBeNull();
      const total = geo.positions.length / 3;
      // The road is night-dark almost everywhere, with a handful of warmer "lamp pool" verts above it —
      // exactly what lights the ground under street lamps when emitted (no projected pool needed).
      expect(vertsInLumaBand(geo.nightColors!, 0, 40)).toBeGreaterThan(total / 2);
      expect(vertsInLumaBand(geo.nightColors!, 90, 256)).toBeGreaterThan(0);
    });
  });
});
