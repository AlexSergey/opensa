import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseIde, parseTimedObjects, parseTxdParents } from './ide.parser';

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

  it('parses anim rows, capturing the IFP name (lowercased) on def.anim', () => {
    const defs = parseIde(['anim', '2, waterfall, water, WFALL_anim, 150, 4', 'end'].join('\n'));
    expect(defs[0]).toEqual({
      anim: 'wfall_anim',
      drawDistance: 150,
      flags: 4,
      id: 2,
      modelName: 'waterfall',
      txdName: 'water',
    });
  });

  it('parses real counxref.ide anim rows (space-padded cells)', () => {
    const defs = parseIde(['anim', '3426 ,nt_noddonkbase ,des_xoilfield ,counxref ,200 ,2097152', 'end'].join('\n'));
    expect(defs[0]).toEqual({
      anim: 'counxref',
      drawDistance: 200,
      flags: 2097152,
      id: 3426,
      modelName: 'nt_noddonkbase',
      txdName: 'des_xoilfield',
    });
  });

  it('handles the mesh-count + multiple draw-distance variant (max wins)', () => {
    const defs = parseIde(['objs', '1700, des_test, des_test, 2, 150, 220, 4', 'end'].join('\n'));
    expect(defs[0].drawDistance).toBe(220);
    expect(defs[0].flags).toBe(4);
  });

  it('returns an empty list when there are no object definitions', () => {
    expect(parseIde('objs\nend\npath\nend')).toEqual([]);
  });

  it('skips objs rows with too few columns', () => {
    expect(parseIde(['objs', '5000, gplane, basicmain', 'end'].join('\n'))).toEqual([]);
  });

  it('skips objs rows whose id is not a number', () => {
    expect(parseIde(['objs', 'NaNid, gplane, basicmain, 300, 0', 'end'].join('\n'))).toEqual([]);
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

  it('skips a malformed tobj row (too few columns to parse)', () => {
    expect(parseTimedObjects(['tobj', 'broken, row', 'end'].join('\n'))).toEqual([]);
  });
});

describe('parseTxdParents', () => {
  it('parses txdp child→parent rows, lowercasing both names', () => {
    const pairs = parseTxdParents(['txdp', 'A51, countn2_gene', 'desert, countn2_gene', 'end'].join('\n'));
    expect(pairs).toEqual([
      ['a51', 'countn2_gene'],
      ['desert', 'countn2_gene'],
    ]);
  });

  it('ignores other sections and malformed (parent-less) rows', () => {
    const pairs = parseTxdParents(
      ['objs', '5000, gplane, basicmain, 300, 0', 'end', 'txdp', 'lonely', 'a51, countn2_gene', 'end'].join('\n'),
    );
    expect(pairs).toEqual([['a51', 'countn2_gene']]);
  });

  it('returns an empty list when there is no txdp section', () => {
    expect(parseTxdParents('objs\n5000, gplane, basicmain, 300, 0\nend')).toEqual([]);
  });
});

const idePath = join(process.cwd(), 'tests', 'original', 'data', 'barriers.ide');
const ideExists = existsSync(idePath);

describe.skipIf(!ideExists)('parseIde (real barriers.ide)', () => {
  it('parses object definitions with model and txd names', () => {
    const defs = parseIde(readFileSync(idePath, 'utf8'));
    expect(defs.length).toBeGreaterThan(0);
    expect(defs[0].modelName.length).toBeGreaterThan(0);
    expect(defs[0].txdName.length).toBeGreaterThan(0);
    expect(Number.isInteger(defs[0].id)).toBe(true);
    // The file leads with the bar_gatebar01 objs row (id 966, txd CJ_BARR_SET_1; names kept as-shipped).
    expect(defs[0]).toMatchObject({ id: 966, modelName: 'bar_gatebar01', txdName: 'CJ_BARR_SET_1' });
  });
});
