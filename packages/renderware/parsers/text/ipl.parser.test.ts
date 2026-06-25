import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseIpl } from './ipl.parser';

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

const iplPath = join(process.cwd(), 'tests', 'original', 'data', 'int_cont.ipl');
const iplExists = existsSync(iplPath);

describe.skipIf(!iplExists)('parseIpl (real int_cont.ipl)', () => {
  it('parses placed instances with finite positions and quaternions', () => {
    const instances = parseIpl(readFileSync(iplPath, 'utf8'));
    expect(instances.length).toBeGreaterThan(0);
    const first = instances[0];
    expect(first.modelName.length).toBeGreaterThan(0);
    expect(first.position.every(Number.isFinite)).toBe(true);
    expect(first.rotation).toHaveLength(4);
    // First inst row: 14650, trukstp04, interior 1, lod -1.
    expect(first).toMatchObject({ id: 14650, interior: 1, lod: -1, modelName: 'trukstp04' });
  });
});
