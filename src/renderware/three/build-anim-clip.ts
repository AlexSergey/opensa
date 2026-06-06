import { AnimationClip, type KeyframeTrack, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three';

import type { IfpAnimation } from '../parsers/binary/ifp';

/** Seconds per raw ANP3 time unit (i16). Tune against the in-game cycle length. */
const DEFAULT_TIME_SCALE = 1 / 60;

export interface BuildAnimClipOptions {
  /**
   * Emit per-bone position tracks too. Off by default: locomotion clips bake the
   * forward motion into the root translation, but physics owns the character's
   * position — so we keep only rotation (in-place animation).
   */
  includeTranslation?: boolean;
  /** Seconds per raw IFP time unit (default {@link DEFAULT_TIME_SCALE}). */
  timeScale?: number;
}

/**
 * Convert one parsed {@link IfpAnimation} into a `THREE.AnimationClip`. Each bone
 * becomes a `QuaternionKeyframeTrack` named `"<bone>.quaternion"` (bone name
 * trimmed); the caller retargets the track names onto a concrete skeleton's
 * bones. Translation tracks are skipped unless `includeTranslation` is set.
 *
 * The IFP quaternion is taken in file order (x, y, z, w); if it renders mirrored,
 * the convention flip belongs here (one place). Times are scaled to seconds.
 */
export function buildAnimationClip(anim: IfpAnimation, options: BuildAnimClipOptions = {}): AnimationClip {
  const timeScale = options.timeScale ?? DEFAULT_TIME_SCALE;
  const tracks: KeyframeTrack[] = [];

  for (const bone of anim.bones) {
    if (bone.frames.length === 0) {
      continue;
    }
    const name = bone.name.trim();
    const times = bone.frames.map((frame) => frame.time * timeScale);

    tracks.push(
      new QuaternionKeyframeTrack(
        `${name}.quaternion`,
        times,
        bone.frames.flatMap((f) => f.rotation),
      ),
    );

    if (options.includeTranslation && bone.frames.some((f) => f.translation)) {
      const positions = bone.frames.flatMap((f) => f.translation ?? [0, 0, 0]);
      tracks.push(new VectorKeyframeTrack(`${name}.position`, times, positions));
    }
  }

  return new AnimationClip(anim.name, -1, tracks);
}
