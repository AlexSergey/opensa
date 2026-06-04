import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseGtaDat } from './gta-dat.parser';
import { parseIpl } from './ipl.parser';

/** Resolve the first IPL file referenced by static/data/gta.dat, if present. */
function referencedIpl(): null | string {
  const datPath = join(process.cwd(), 'static', 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return null;
  }
  const relative = parseGtaDat(readFileSync(datPath, 'utf8')).ipl[0];
  if (!relative) {
    return null;
  }
  const resolved = join(process.cwd(), 'static', relative.replace(/\\/g, '/').toLowerCase());

  return existsSync(resolved) ? resolved : null;
}

describe('parseIpl', () => {
  it('parses inst rows and ignores other sections', () => {
    const instances = parseIpl(
      [
        'inst',
        '5000, gplane, 0, 0.0, -0.0778266, 23.9985, 0.0, 0.0, 0.0, 1.0, -1',
        'end',
        'cull',
        '0, 0, 0, 1, 2, 3',
        'end',
      ].join('\n'),
    );
    expect(instances).toHaveLength(1);
    expect(instances[0]).toEqual({
      id: 5000,
      interior: 0,
      lod: -1,
      modelName: 'gplane',
      position: [0, -0.0778266, 23.9985],
      rotation: [0, 0, 0, 1],
    });
  });

  it('skips malformed rows that are too short', () => {
    expect(parseIpl('inst\n5000, gplane, 0\nend')).toEqual([]);
  });
});

const iplPath = referencedIpl();

// Map-agnostic: parses whichever IPL the current gta.dat references.
describe.skipIf(!iplPath)('parseIpl (real IPL from gta.dat)', () => {
  it('parses placed instances with finite positions and quaternions', () => {
    const instances = parseIpl(readFileSync(iplPath!, 'utf8'));
    expect(instances.length).toBeGreaterThan(0);
    const first = instances[0];
    expect(first.modelName.length).toBeGreaterThan(0);
    expect(first.position.every(Number.isFinite)).toBe(true);
    expect(first.rotation).toHaveLength(4);
  });
});
