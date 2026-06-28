import { describe, expect, it } from 'vitest';

import { mergeCarcols, mergeCarmods, mergeHandling, mergeIde } from './merge';

const IDE = ['cars', '400, landstal, landstal, car', '445, admiral, admiral, car', 'end'].join('\n');
const HANDLING = ['LANDSTAL 1700 a b c', 'ADMIRAL 2000 a b c'].join('\n');
const CARCOLS = ['car', 'admiral, 1,1', 'ambulan, 2,2', 'end', 'car4', 'camper, 1,2,3,4', 'end'].join('\n');
const CARCOLS_MOVE = ['car', 'admiral, 1,1', 'end', 'car4', 'camper, 1,31,1,0', 'squalo, 0,0,0,1', 'end'].join('\n');
const CARMODS = ['mods', 'admiral, nto_b_l', 'banshee, nto_b_s', 'end'].join('\n');

/** The ordered column-0 model keys of `<section> … end`. */
function modelsIn(text: string, section: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === section);
  const out: string[] = [];
  for (let i = start + 1; i < lines.length && lines[i].trim() !== 'end'; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed !== '') {
      out.push(trimmed.split(',')[0].trim());
    }
  }

  return out;
}

describe('merge', () => {
  describe('negative cases', () => {
    it('mergeIde leaves text without a cars section unchanged', () => {
      expect(mergeIde('objs\nfoo\nend', '500, alpha, alpha, car')).toBe('objs\nfoo\nend');
    });

    it('mergeCarcols leaves the file unchanged when neither colour section exists', () => {
      expect(mergeCarcols('objs\nfoo\nend', 'camper, 1,2,3,4')).toBe('objs\nfoo\nend');
    });
  });

  describe('positive cases', () => {
    it('mergeIde replaces the cars line by model, keeping the others', () => {
      const out = mergeIde(IDE, '445, admiral, newtxd, car');
      expect(out).toContain('445, admiral, newtxd, car');
      expect(out).not.toContain('445, admiral, admiral, car');
      expect(out).toContain('400, landstal, landstal, car');
    });

    it('mergeIde appends a new model before end', () => {
      // cars lines are `id, model, …` — modelsIn reads column 0 (the id), so this checks the append order.
      expect(modelsIn(mergeIde(IDE, '500, alpha, alpha, car'), 'cars')).toEqual(['400', '445', '500']);
    });

    it('mergeHandling replaces a line by id and appends a new one', () => {
      expect(mergeHandling(HANDLING, 'ADMIRAL 9999 x y z')).toContain('ADMIRAL 9999 x y z');
      expect(mergeHandling(HANDLING, 'ADMIRAL 9999 x y z')).not.toContain('ADMIRAL 2000 a b c');
      expect(mergeHandling(HANDLING, 'ALPHA 5000 x y z')).toContain('ALPHA 5000 x y z');
    });

    it('mergeCarcols replaces a 2-colour line in car (detected from the line) and keeps it alpha-sorted', () => {
      const out = mergeCarcols(CARCOLS, 'admiral, 9,9');
      expect(out).toContain('admiral, 9,9');
      expect(modelsIn(out, 'car')).toEqual(['admiral', 'ambulan']);
    });

    it('mergeCarcols inserts a new 2-colour car in alphabetical position', () => {
      expect(modelsIn(mergeCarcols(CARCOLS, 'alpha, 5,5'), 'car')).toEqual(['admiral', 'alpha', 'ambulan']);
    });

    it('mergeCarcols routes a 4-colour line (4 values/combo) into car4, sorted', () => {
      const out = mergeCarcols(CARCOLS, 'cement, 1,1,1,1');
      expect(modelsIn(out, 'car4')).toEqual(['camper', 'cement']);
      expect(modelsIn(out, 'car')).toEqual(['admiral', 'ambulan']); // car section untouched
    });

    it('moves a model car → car4 when the new line has 4 colours (removed from car)', () => {
      const out = mergeCarcols(CARCOLS_MOVE, 'admiral, 1,2,3,4, 5,6,7,8');
      expect(modelsIn(out, 'car')).toEqual([]); // admiral left car
      expect(modelsIn(out, 'car4')).toEqual(['admiral', 'camper', 'squalo']); // now in car4, sorted
    });

    it('moves a model car4 → car when the new line has 2 colours (removed from car4)', () => {
      const out = mergeCarcols(CARCOLS_MOVE, 'camper, 1,2, 3,4');
      expect(modelsIn(out, 'car4')).toEqual(['squalo']); // camper left car4
      expect(modelsIn(out, 'car')).toEqual(['admiral', 'camper']); // now in car, sorted
    });

    it('mergeCarmods inserts a model into the mods section in alphabetical order', () => {
      expect(modelsIn(mergeCarmods(CARMODS, 'alpha, nto_b_tw'), 'mods')).toEqual(['admiral', 'alpha', 'banshee']);
    });

    it('mergeCarmods replaces an existing model line', () => {
      const out = mergeCarmods(CARMODS, 'admiral, exh_b_l, exh_b_t');
      expect(out).toContain('admiral, exh_b_l, exh_b_t');
      expect(out).not.toContain('admiral, nto_b_l');
    });
  });
});
