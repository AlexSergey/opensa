import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseCarGroups } from '@opensa/renderware/parsers/text/cargrp.parser';
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  stripCarcols,
  stripCarGroups,
  stripCarmods,
  stripGta3Img,
  stripHandling,
  stripIde,
  stripParked,
} from './strip';

const IDE = ['cars', '400, landstal, landstal, car', '445, admiral, admiral, car', 'end'].join('\n');
const HANDLING = ['; header', 'LANDSTAL 1700 a b c', 'ADMIRAL 2000 a b c', '% PREDATOR 0.7', '! boat 1'].join('\n');
const CARCOLS = ['col', '0,0,0 # 0', '1,1,1 # 1', 'end', 'car', 'admiral, 1,1', 'ambulan, 2,2', 'end'].join('\n');
const CARMODS = ['link', 'a, b', 'end', 'mods', 'admiral, nto_b_l', 'banshee, nto_b_s', 'end'].join('\n');
const CARGRP = ['# header', 'taxi, admiral, mule\t# WORKERS', 'banshee, comet # RICH'].join('\n');
const PARKED = JSON.stringify([
  { colour: '57,57', heading: 0, model: 'admiral', position: [1, 2, 3] },
  { colour: '6,3', heading: 0, model: 'comet', position: [4, 5, 6] },
]);

describe('strip', () => {
  describe('positive cases', () => {
    it('stripIde keeps only the installed models in the cars section', () => {
      const out = stripIde(IDE, new Set(['admiral']));
      expect(out).toContain('445, admiral, admiral, car');
      expect(out).not.toContain('landstal');
      expect(out.split('\n').filter((l) => l.trim() !== '')).toEqual(['cars', '445, admiral, admiral, car', 'end']);
    });

    it('stripHandling keeps only the installed ids, leaving comments and sub-tables', () => {
      const out = stripHandling(HANDLING, new Set(['ADMIRAL']));
      const handling = parseHandling(out);
      expect(handling.has('ADMIRAL')).toBe(true);
      expect(handling.has('LANDSTAL')).toBe(false);
      expect(out).toContain('% PREDATOR'); // non-car sub-table kept
      expect(out).toContain('; header'); // comment kept
    });

    it('stripCarcols keeps the col palette and only installed cars', () => {
      const carcols = parseCarcols(stripCarcols(CARCOLS, new Set(['admiral'])));
      expect(carcols.palette).toHaveLength(2); // col section untouched
      expect(carcols.cars.has('admiral')).toBe(true);
      expect(carcols.cars.has('ambulan')).toBe(false);
    });

    it('stripCarmods keeps link/wheel and only installed mods', () => {
      const carmods = parseCarmods(stripCarmods(CARMODS, new Set(['admiral'])));
      expect(carmods.links).toHaveLength(1); // link section untouched
      expect(carmods.mods.has('admiral')).toBe(true);
      expect(carmods.mods.has('banshee')).toBe(false);
    });

    it('stripCarGroups keeps only installed models per group, preserving group lines + labels', () => {
      // The line for a group with no installed cars is kept (emptied) so group order/index is preserved.
      expect(stripCarGroups(CARGRP, new Set(['admiral'])).split('\n')).toEqual([
        '# header',
        'admiral\t# WORKERS', // taxi + mule dropped
        '\t# RICH', // banshee + comet dropped → emptied, line kept
      ]);
      // The kept group still parses to just the installed model.
      expect(parseCarGroups(stripCarGroups(CARGRP, new Set(['admiral'])))[0]).toEqual({
        comment: 'WORKERS',
        models: ['admiral'],
      });
    });

    it('stripParked keeps only the installed models entries', () => {
      const parked = JSON.parse(stripParked(PARKED, new Set(['admiral']))) as { model: string }[];
      expect(parked.map((p) => p.model)).toEqual(['admiral']); // comet dropped
    });
  });
});

describe('stripGta3Img', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'strip-img-'));
  });

  afterEach(() => {
    rmSync(dir, { force: true, recursive: true });
  });

  describe('positive cases', () => {
    it('keeps only the named entries, dropping the rest', () => {
      const imgPath = join(dir, 'gta3.img');
      const img = createImg();
      img.set('admiral.dff', Uint8Array.of(1));
      img.set('admiral.txd', Uint8Array.of(2));
      img.set('building.dff', Uint8Array.of(3));
      writeFileSync(imgPath, img.build());

      stripGta3Img(imgPath, new Set(['admiral.dff', 'admiral.txd']));

      const after = openImg(new Uint8Array(readFileSync(imgPath)));
      expect(
        after
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['admiral.dff', 'admiral.txd']);
    });
  });
});
