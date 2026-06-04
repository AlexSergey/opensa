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

const iplPath = join(process.cwd(), 'static', 'data', 'maps', 'basic', 'basicmap.IPL');

describe.skipIf(!existsSync(iplPath))('parseIpl (real basicmap.IPL)', () => {
  it('places three instances including gplane at its world position', () => {
    const instances = parseIpl(readFileSync(iplPath, 'utf8'));
    expect(instances).toHaveLength(3);
    const gplane = instances.find((i) => i.modelName === 'gplane')!;
    expect(gplane.id).toBe(5000);
    expect(gplane.position[2]).toBeCloseTo(23.9985, 4);
  });
});
