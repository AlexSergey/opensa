import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseGtaDat } from './gta-dat.parser';
import { parseIde, parseTimedObjects } from './ide.parser';

/** Resolve the first IDE/IPL file referenced by static/data/gta.dat, if present. */
function referencedFromDat(kind: 'ide' | 'ipl'): null | string {
  const datPath = join(process.cwd(), 'static', 'data', 'gta.dat');
  if (!existsSync(datPath)) {
    return null;
  }
  const dat = parseGtaDat(readFileSync(datPath, 'utf8'));
  const relative = (kind === 'ide' ? dat.ide : dat.ipl)[0];
  if (!relative) {
    return null;
  }
  const resolved = join(process.cwd(), 'static', relative.replace(/\\/g, '/').toLowerCase());

  return existsSync(resolved) ? resolved : null;
}

describe('parseIde', () => {
  it('parses objs + anim rows and excludes tobj / non-placeable sections', () => {
    const defs = parseIde(
      [
        'objs',
        '5000, gplane, basicmain, 300, 0',
        '5404, testground, testground, 290, 0',
        'end',
        'anim',
        '2, waterfall, water, wfall_anim, 150, 4',
        'end',
        'tobj',
        '1, neon_sign, lvneon, 100, 0, 6, 20',
        'end',
        'path',
        'end',
      ].join('\n'),
    );
    expect(defs).toHaveLength(3);
    expect(defs.map((d) => d.id).sort((a, b) => a - b)).toEqual([2, 5000, 5404]);
    expect(defs.find((d) => d.id === 1)).toBeUndefined();
  });

  it('parses objs rows with id/model/txd', () => {
    const defs = parseIde(['objs', '5000, gplane, basicmain, 300, 0', 'end'].join('\n'));
    expect(defs[0]).toEqual({ drawDistance: 300, flags: 0, id: 5000, modelName: 'gplane', txdName: 'basicmain' });
  });

  it('parses anim rows, ignoring the non-numeric anim name', () => {
    const defs = parseIde(['anim', '2, waterfall, water, wfall_anim, 150, 4', 'end'].join('\n'));
    expect(defs[0]).toEqual({ drawDistance: 150, flags: 4, id: 2, modelName: 'waterfall', txdName: 'water' });
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

describe('parseTimedObjects', () => {
  it('parses tobj rows, capturing the trailing time-on/time-off pair as the time window', () => {
    const defs = parseTimedObjects(['tobj', '1, neon_sign, lvneon, 100, 0, 6, 20', 'end'].join('\n'));
    expect(defs[0]).toEqual({
      drawDistance: 100,
      flags: 0,
      id: 1,
      modelName: 'neon_sign',
      time: { off: 20, on: 6 },
      txdName: 'lvneon',
    });
  });

  it('ignores objs / anim sections', () => {
    expect(parseTimedObjects(['objs', '5000, gplane, basicmain, 300, 0', 'end'].join('\n'))).toEqual([]);
  });
});

const idePath = referencedFromDat('ide');

// Map-agnostic: parses whichever IDE the current gta.dat references.
describe.skipIf(!idePath)('parseIde (real IDE from gta.dat)', () => {
  it('parses object definitions with model and txd names', () => {
    const defs = parseIde(readFileSync(idePath!, 'utf8'));
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].modelName.length).toBeGreaterThan(0);
    expect(defs[0].txdName.length).toBeGreaterThan(0);
    expect(Number.isInteger(defs[0].id)).toBe(true);
  });
});
