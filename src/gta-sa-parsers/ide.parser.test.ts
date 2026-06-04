import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseIde } from './ide.parser';

describe('parseIde', () => {
  it('parses objs rows and ignores other sections', () => {
    const defs = parseIde(
      [
        'objs',
        '5000, gplane, basicmain, 300, 0',
        '5404, testground, testground, 290, 0',
        'end',
        'tobj',
        '1, foo, bar, 100, 0, 6, 20',
        'end',
        'path',
        'end',
      ].join('\n'),
    );
    expect(defs).toHaveLength(2);
    expect(defs[0]).toEqual({ drawDistance: 300, flags: 0, id: 5000, modelName: 'gplane', txdName: 'basicmain' });
    expect(defs[1].id).toBe(5404);
    expect(defs[1].txdName).toBe('testground');
  });

  it('handles the mesh-count + multiple draw-distance variant (max wins)', () => {
    const defs = parseIde(['objs', '1700, des_test, des_test, 2, 150, 220, 4', 'end'].join('\n'));
    expect(defs[0].drawDistance).toBe(220);
    expect(defs[0].flags).toBe(4);
  });

  it('returns an empty list when there are no object definitions', () => {
    expect(parseIde('objs\nend\npath\nend')).toEqual([]);
  });
});

const idePath = join(process.cwd(), 'static', 'data', 'maps', 'basic', 'basicmap.ide');

describe.skipIf(!existsSync(idePath))('parseIde (real basicmap.ide)', () => {
  it('defines gplane (5000) and testground (5404)', () => {
    const defs = parseIde(readFileSync(idePath, 'utf8'));
    const byId = new Map(defs.map((d) => [d.id, d]));
    expect(byId.get(5000)).toMatchObject({ modelName: 'gplane', txdName: 'basicmain' });
    expect(byId.get(5404)).toMatchObject({ modelName: 'testground', txdName: 'testground' });
  });
});
