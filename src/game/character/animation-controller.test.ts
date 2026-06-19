import { AnimationClip, Bone, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';
import { describe, expect, it } from 'vitest';

import { retargetClip } from './animation-controller';

function bones(...names: string[]): Map<string, Bone> {
  return new Map(
    names.map((name) => {
      const bone = new Bone();
      bone.name = name;

      return [name, bone];
    }),
  );
}

/** A clip with IFP-style track names: a `Normal` root, a spaced `Spine 1`, and an unknown bone. */
function clip(): AnimationClip {
  return new AnimationClip('walk', 1, [
    new QuaternionKeyframeTrack('Normal.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
    new VectorKeyframeTrack('Spine 1.position', [0, 1], [0, 0, 0, 1, 1, 1]),
    new QuaternionKeyframeTrack('Unknown.quaternion', [0], [0, 0, 0, 1]),
  ]);
}

describe('retargetClip', () => {
  describe('positive cases', () => {
    it('renames tracks onto the skeleton bones (Normal→Root, spacing-insensitive) and drops unmatched', () => {
      const retargeted = retargetClip(clip(), bones('Root', 'Spine1'));
      expect(retargeted.tracks.map((t) => t.name)).toEqual(['Root.quaternion', 'Spine1.position']);
    });

    it('does not mutate the source clip', () => {
      const source = clip();
      retargetClip(source, bones('Root', 'Spine1'));
      expect(source.tracks[0].name).toBe('Normal.quaternion');
    });

    it('aliases the root track onto a renamed skeleton root (e.g. a mod renamed it)', () => {
      // No bone named Root/Normal; the real root is `MrAndres5555` — the root track must still retarget.
      const retargeted = retargetClip(clip(), bones('MrAndres5555', 'Spine1'), 'MrAndres5555');
      expect(retargeted.tracks.map((t) => t.name)).toEqual(['MrAndres5555.quaternion', 'Spine1.position']);
    });

    it('drops the root track when the root is renamed and no rootBoneName is given', () => {
      const retargeted = retargetClip(clip(), bones('MrAndres5555', 'Spine1'));
      expect(retargeted.tracks.map((t) => t.name)).toEqual(['Spine1.position']);
    });
  });
});
