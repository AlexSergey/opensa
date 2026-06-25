import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { parseGtaDat } from './gta-dat.parser';

describe('parseGtaDat', () => {
  it('collects IMG, IDE and IPL directives and ignores comments/blanks/unknowns', () => {
    const dat = parseGtaDat(
      [
        '# a comment',
        '',
        'IMG IMG\\basicmap',
        'COLFILE 0 IMG\\basicmap',
        'IDE DATA\\MAPS\\basic\\basicmap.IDE',
        'SPLASH loadsc2',
        'IPL DATA\\MAPS\\basic\\basicmap.IPL',
      ].join('\n'),
    );
    expect(dat.img).toEqual(['IMG\\basicmap']);
    expect(dat.ide).toEqual(['DATA\\MAPS\\basic\\basicmap.IDE']);
    expect(dat.ipl).toEqual(['DATA\\MAPS\\basic\\basicmap.IPL']);
  });

  it('treats the directive case-insensitively', () => {
    const dat = parseGtaDat('img folderA\nide fileB.ide');
    expect(dat.img).toEqual(['folderA']);
    expect(dat.ide).toEqual(['fileB.ide']);
  });

  it('supports multiple entries of the same directive', () => {
    const dat = parseGtaDat('IPL a.ipl\nIPL b.ipl');
    expect(dat.ipl).toEqual(['a.ipl', 'b.ipl']);
  });
});

const datPath = join(process.cwd(), 'tests', 'original', 'data', 'gta.dat');

// Map-agnostic: asserts structure for whatever gta.dat currently lives in tests/data.
describe.skipIf(!existsSync(datPath))('parseGtaDat (real gta.dat)', () => {
  it('references at least one IMG, IDE and IPL', () => {
    const dat = parseGtaDat(readFileSync(datPath, 'utf8'));
    expect(dat.img.length).toBeGreaterThan(0);
    expect(dat.ide.length).toBeGreaterThan(0);
    expect(dat.ipl.length).toBeGreaterThan(0);
  });
});
