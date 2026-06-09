import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseDff } from './dff';

// Two real Ganton houses that look identical by day but differ at night (the difference is the SA "extra
// vertex colour" / night prelit set, chunk 0x253F2F9, which our parser now reads):
//   compfukhouse3 (id 3589)  — lit windows at night: bright warm verts in its night colours.
//   mcstraps_LAe2 (id 17699) — windows stay dark: night colours are dull, no bright warm window verts.
const houses = {
  dark: join(process.cwd(), 'tests', 'world', 'mcstraps_LAe2.dff'),
  lit: join(process.cwd(), 'tests', 'world', 'compfukhouse3.dff'),
};
const haveFixtures = existsSync(houses.lit) && existsSync(houses.dark);

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

describe.skipIf(!haveFixtures)('parseDff night vertex colours (0x253F2F9)', () => {
  describe('negative cases', () => {
    it('reads night colours for a house whose windows stay dark, with no bright warm window verts', () => {
      const geo = geometryOf(houses.dark);
      expect(geo.nightColors).not.toBeNull();
      expect(geo.nightColors!.length).toBe((geo.positions.length / 3) * 4);
      expect(litWindowVerts(geo.nightColors!)).toBe(0);
    });
  });

  describe('positive cases', () => {
    it('reads night colours with bright warm window verts for a house with lit windows', () => {
      const geo = geometryOf(houses.lit);
      expect(geo.nightColors).not.toBeNull();
      expect(geo.nightColors!.length).toBe((geo.positions.length / 3) * 4);
      expect(litWindowVerts(geo.nightColors!)).toBeGreaterThan(0);
    });

    it('exposes night colours as a separate set from the (grey) day prelit colours', () => {
      const geo = geometryOf(houses.lit);
      expect(geo.prelitColors).not.toBeNull();
      expect(geo.nightColors).not.toBe(geo.prelitColors); // distinct buffers — day stays grey, night lights up
    });
  });
});
