import { QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';

import type { IfpAnimation } from '../parsers/binary/ifp';

import { buildAnimationClip } from './build-anim-clip';

/** A two-bone animation: a root with translation + a rotation-only bone. */
function anim(): IfpAnimation {
  return {
    bones: [
      {
        boneId: 0,
        frames: [
          { rotation: [0, 0, 0, 1], time: 0, translation: [1, 2, 3] },
          { rotation: [0, 0, 0, 1], time: 60, translation: [4, 5, 6] },
        ],
        name: 'Root',
      },
      {
        boneId: 1,
        frames: [{ rotation: [0.5, 0, 0, 1], time: 0 }],
        name: ' Spine',
      },
    ],
    name: 'WALK_test',
  };
}

describe('buildAnimationClip', () => {
  describe('positive cases', () => {
    it('builds one quaternion track per bone, named by the trimmed bone, with scaled times', () => {
      const clip = buildAnimationClip(anim(), { timeScale: 1 / 60 });
      expect(clip.name).toBe('WALK_test');
      expect(clip.tracks).toHaveLength(2);
      expect(clip.tracks.every((t) => t instanceof QuaternionKeyframeTrack)).toBe(true);
      expect(clip.tracks.map((t) => t.name)).toEqual(['Root.quaternion', 'Spine.quaternion']);
      expect(Array.from(clip.tracks[0].times)).toEqual([0, 1]); // 0 and 60 → 0 s and 1 s
    });

    it('skips translation by default and emits position tracks when requested', () => {
      const withTranslation = buildAnimationClip(anim(), { includeTranslation: true });
      const positionTrack = withTranslation.tracks.find((t) => t.name === 'Root.position');
      expect(positionTrack).toBeInstanceOf(VectorKeyframeTrack);
      expect(Array.from(positionTrack?.values ?? [])).toEqual([1, 2, 3, 4, 5, 6]);
      // The rotation-only bone never gets a position track.
      expect(withTranslation.tracks.some((t) => t.name === 'Spine.position')).toBe(false);
    });
  });
});
