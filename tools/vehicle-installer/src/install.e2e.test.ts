import { parseCarcols } from '@opensa/renderware/parsers/text/carcols.parser';
import { parseCarGroups } from '@opensa/renderware/parsers/text/cargrp.parser';
import { parseCarmods } from '@opensa/renderware/parsers/text/carmods.parser';
import { parseHandling } from '@opensa/renderware/parsers/text/handling.parser';
import { parseVehicleDefs } from '@opensa/renderware/parsers/text/vehicle-defs.parser';
import { createImg, openImg } from '@opensa/tool-kit/archive/img';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { install } from './install';

const DATA = join(process.cwd(), 'tests', 'original', 'data');
const DATA_FILES = ['carcols.dat', 'carmods.dat', 'cargrp.dat', 'handling.cfg', 'vehicles.ide'];
const PARKED = join(process.cwd(), 'tests', 'original', 'parked.json');
const hasFixtures = DATA_FILES.every((file) => existsSync(join(DATA, file))) && existsSync(PARKED);

// Distinct modded values so each merge is observable against the stock data.
const IDE = '445, admiral, admtxdmod, car, ADMIRAL, ADMIRAL, null, normal, 4, 0, 0, -1, 0.70, 0.70, 0';
const HANDLING =
  'ADMIRAL 9999.0 3650.0 1.6 0.0 0.1 -0.2 70 0.70 0.80 0.5 4 180.0 14.0 10.0 R P 4.3 0.63 1 28.0 ' +
  '0.93 0.81 0.0 0.22 -0.15 0.5 0.0 0.26 0.44 10000 0 1400001 0 3 0';
const CARCOLS = 'admiral, 5,5';
const CARMODS = 'admiral, exh_b_l';

const CABBIE_PALETTE = ['233,199,40   # new1 yellow taxi cab   yellow', '186,208,125  # new2 light green cab   green'];
const CABBIE_CARCOLS = 'cabbie, 6,0,6,0, new2,0,new2,0, new1,0,new1,0'; // 4-colour, with newN refs

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vehicle-installer-e2e-'));
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe.skipIf(!hasFixtures)('install (end-to-end, real data fixtures)', () => {
  describe('positive cases', () => {
    it('puts dff/txd into gta3.img and merges the four settings into the data files', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      // Base game: the real stock data files + a gta3.img holding the stock admiral.dff.
      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9)); // stock
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      // The vehicle: synthetic dff/txd + a settings file carrying the four modded blocks.
      const folder = join(mods, 'admiral - 1976 Mercedes-Benz 230');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'admiral.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'admiral.settings.txt'), [IDE, HANDLING, CARCOLS, CARMODS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out });

      // gta3.img: the new dff replaced the stock one + the txd was added.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(new Uint8Array(img.get('admiral.dff')!)[0]).toBe(1);
      expect(img.has('admiral.txd')).toBe(true);

      // vehicles.ide + handling.cfg: the admiral entry was replaced in place.
      expect(parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8')).get('admiral')?.txd).toBe(
        'admtxdmod',
      );
      expect(parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8')).get('ADMIRAL')?.fields[0]).toBe(
        '9999.0',
      );

      // carcols + carmods: admiral replaced; both sections still alpha-sorted (admiral before alpha).
      const carcols = parseCarcols(readFileSync(join(out, 'data', 'carcols.dat'), 'utf8'));
      expect(carcols.cars.get('admiral')).toEqual([[5, 5]]);
      const carcolsText = readFileSync(join(out, 'data', 'carcols.dat'), 'utf8');
      expect(carcolsText.indexOf('\nadmiral,')).toBeLessThan(carcolsText.indexOf('\nalpha,'));

      const carmods = parseCarmods(readFileSync(join(out, 'data', 'carmods.dat'), 'utf8'));
      expect(carmods.mods.get('admiral')).toEqual(['exh_b_l']);
    });

    it('appends custom palette colours and resolves the carcols newN refs (cabbie-style)', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('dummy.dff', Uint8Array.of(0));
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'cabbie - 1989 Chevrolet Caprice Taxi');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'cabbie.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'cabbie.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'cabbie.settings.txt'), [CABBIE_PALETTE.join('\n'), CABBIE_CARCOLS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out });

      const carcolsText = readFileSync(join(out, 'data', 'carcols.dat'), 'utf8');
      const carcols = parseCarcols(carcolsText);
      // Stock palette has 127 colours (ids 0–126) → the two custom colours become ids 127 and 128.
      expect(carcols.palette).toHaveLength(129);
      expect(carcols.palette[127]).toEqual([233, 199, 40]);
      expect(carcols.palette[128]).toEqual([186, 208, 125]);
      // The 4-colour cabbie line resolved its newN refs to those ids and landed in car4.
      expect(carcols.cars4.get('cabbie')).toEqual([
        [6, 0, 6, 0],
        [128, 0, 128, 0],
        [127, 0, 127, 0],
      ]);
      expect(carcolsText).not.toMatch(/\bnew[12]\b/); // no unresolved refs left in the file
    });

    it('--strip reduces gta3.img + the four data files to only the installed vehicle', () => {
      const game = join(root, 'game');
      const mods = join(root, 'in');
      const out = join(root, 'out');

      mkdirSync(join(game, 'data'), { recursive: true });
      for (const file of DATA_FILES) {
        cpSync(join(DATA, file), join(game, 'data', file));
      }
      cpSync(PARKED, join(game, 'parked.json'));
      mkdirSync(join(game, 'models'), { recursive: true });
      const baseImg = createImg();
      baseImg.set('admiral.dff', Uint8Array.of(9)); // stock model we replace
      baseImg.set('player.dff', Uint8Array.of(8)); // unrelated model — must be stripped
      writeFileSync(join(game, 'models', 'gta3.img'), baseImg.build());

      const folder = join(mods, 'admiral - test');
      mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'admiral.dff'), Uint8Array.of(1));
      writeFileSync(join(folder, 'admiral.txd'), Uint8Array.of(2));
      writeFileSync(join(folder, 'admiral.settings.txt'), [IDE, HANDLING, CARCOLS, CARMODS].join('\n\n'));

      install({ gamePath: game, inPath: mods, outPath: out, strip: true });

      // gta3.img: only the installed vehicle's entries remain.
      const img = openImg(new Uint8Array(readFileSync(join(out, 'models', 'gta3.img'))));
      expect(
        img
          .names()
          .map((n) => n.toLowerCase())
          .sort(),
      ).toEqual(['admiral.dff', 'admiral.txd']);

      // the four data files: only `admiral` survives (and the carcols `col` palette + carmods link/wheel).
      const defs = parseVehicleDefs(readFileSync(join(out, 'data', 'vehicles.ide'), 'utf8'));
      expect([...defs.keys()]).toEqual(['admiral']);
      const handling = parseHandling(readFileSync(join(out, 'data', 'handling.cfg'), 'utf8'));
      expect([...handling.keys()]).toEqual(['ADMIRAL']);
      const carcols = parseCarcols(readFileSync(join(out, 'data', 'carcols.dat'), 'utf8'));
      expect([...carcols.cars.keys(), ...carcols.cars4.keys()]).toEqual(['admiral']);
      expect(carcols.palette.length).toBeGreaterThan(100); // col palette kept
      const carmods = parseCarmods(readFileSync(join(out, 'data', 'carmods.dat'), 'utf8'));
      expect([...carmods.mods.keys()]).toEqual(['admiral']);
      expect(carmods.wheels.size).toBeGreaterThan(0); // wheel section kept

      // cargrp.dat: every group keeps only admiral (other models dropped).
      const groups = parseCarGroups(readFileSync(join(out, 'data', 'cargrp.dat'), 'utf8'));
      expect(groups.every((group) => group.models.every((model) => model === 'admiral'))).toBe(true);
      expect(groups.some((group) => group.models.includes('admiral'))).toBe(true);

      // parked.json: only the installed model's parked entries remain.
      const parked = JSON.parse(readFileSync(join(out, 'parked.json'), 'utf8')) as { model: string }[];
      expect(parked.every((entry) => entry.model === 'admiral')).toBe(true);
    });
  });
});
