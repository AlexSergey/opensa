import { describe, expect, it } from 'vitest';

import { concat, fixedString, i16, i32, toArrayBuffer } from '../../test-utils';
import { parseIfp } from './ifp';

const NAME = 24;

/** Build a synthetic ANP3 IFP: one animation with a type-4 root + a type-3 bone. */
function buildAnp3(): ArrayBuffer {
  const root = concat(
    fixedString('Root', NAME),
    i32(4), // frameType (with translation)
    i32(2), // frameCount
    i32(0), // boneId
    // frame 0: quat (0,0,0,1), time 0, translation (1, 2, 0)
    i16(0),
    i16(0),
    i16(0),
    i16(4096),
    i16(0),
    i16(1024),
    i16(2048),
    i16(0),
    // frame 1: quat (0,0,0,1), time 30, translation (0, 0, 0)
    i16(0),
    i16(0),
    i16(0),
    i16(4096),
    i16(30),
    i16(0),
    i16(0),
    i16(0),
  );
  const spine = concat(
    fixedString(' Spine', NAME),
    i32(3), // frameType (rotation only)
    i32(1), // frameCount
    i32(1), // boneId
    // frame 0: quat (0.5, 0, 0, 1), time 0
    i16(2048),
    i16(0),
    i16(0),
    i16(4096),
    i16(0),
  );

  return toArrayBuffer(
    concat(
      fixedString('ANP3', 4),
      i32(0), // size (ignored)
      fixedString('ped', NAME),
      i32(1), // numAnimations
      fixedString('WALK_test', NAME),
      i32(2), // numBones
      i32(0), // unused
      i32(0), // unused
      root,
      spine,
    ),
  );
}

describe('parseIfp', () => {
  describe('negative cases', () => {
    it('rejects a non-ANP3 file', () => {
      expect(() => parseIfp(toArrayBuffer(concat(fixedString('ANPK', 4), i32(0))))).toThrow(/ANP3/);
    });
  });

  describe('positive cases', () => {
    it('parses animations, bones and keyframes', () => {
      const [anim] = parseIfp(buildAnp3());
      expect(anim.name).toBe('WALK_test');
      expect(anim.bones).toHaveLength(2);
      expect(anim.bones.map((b) => b.name)).toEqual(['Root', ' Spine']);
    });

    it('reads root translation (type 4) and rotation, scaled', () => {
      const root = parseIfp(buildAnp3())[0].bones[0];
      expect(root.frames).toHaveLength(2);
      expect(root.frames[0].rotation).toEqual([0, 0, 0, 1]);
      expect(root.frames[0].translation).toEqual([1, 2, 0]);
      expect(root.frames[1].time).toBe(30);
    });

    it('leaves translation undefined on rotation-only (type 3) bones', () => {
      const spine = parseIfp(buildAnp3())[0].bones[1];
      expect(spine.frames[0].rotation).toEqual([0.5, 0, 0, 1]);
      expect(spine.frames[0].translation).toBeUndefined();
    });
  });
});
