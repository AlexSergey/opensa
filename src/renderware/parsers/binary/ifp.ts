import { BinaryStream } from './binary-stream';

/** One animation: a set of per-bone tracks. */
export interface IfpAnimation {
  bones: IfpBone[];
  name: string;
}

/** One bone's animation track (keyframes), named to match the skeleton bone. */
export interface IfpBone {
  boneId: number;
  frames: IfpKeyframe[];
  /** Bone name as stored (may carry a leading space, e.g. " Pelvis"); trim to match the skeleton. */
  name: string;
}

/** One keyframe of a bone's animation track. */
export interface IfpKeyframe {
  /** Quaternion (x, y, z, w) in file order; consumer fixes the convention. */
  rotation: [number, number, number, number];
  /** Raw ANP3 time value (i16); the clip builder scales it to seconds. */
  time: number;
  /** Bone translation (only present on frame-type-4 tracks, e.g. the root). */
  translation?: [number, number, number];
}

const NAME_LENGTH = 24;
const ROTATION_SCALE = 4096; // i16 fixed-point → quaternion component
const TRANSLATION_SCALE = 1024; // i16 fixed-point → translation unit
const FRAME_TYPE_WITH_TRANSLATION = 4;

/**
 * Parse a GTA San Andreas IFP animation package (the **ANP3** variant, e.g.
 * `ped.ifp`) into renderer-agnostic animation data. Layout: `"ANP3"`, size, a
 * 24-byte internal name, animation count; then per animation a name + bone
 * count + two unused words; then per bone a name, frame type, frame count, bone
 * id; then per frame a quaternion (4×i16 / 4096), a time (i16), and — for
 * frame-type 4 (the root) — a translation (3×i16 / 1024). Names are 24-byte
 * fields read to the first NUL (a trailing 3ds-max export path is ignored).
 */
export function parseIfp(buffer: ArrayBuffer): IfpAnimation[] {
  const stream = new BinaryStream(buffer);
  const magic = stream.string(4);
  if (magic !== 'ANP3') {
    throw new Error(`Unsupported IFP format: expected ANP3, got "${magic}"`);
  }
  stream.skip(4); // size (file size − 8); the structure is self-describing
  stream.string(NAME_LENGTH); // internal name (e.g. "ped")
  const numAnimations = stream.i32();

  const animations: IfpAnimation[] = [];
  for (let a = 0; a < numAnimations; a += 1) {
    const name = stream.string(NAME_LENGTH);
    const numBones = stream.i32();
    stream.skip(8); // two unused words
    const bones: IfpBone[] = [];
    for (let b = 0; b < numBones; b += 1) {
      bones.push(parseBone(stream));
    }
    animations.push({ bones, name });
  }

  return animations;
}

function parseBone(stream: BinaryStream): IfpBone {
  const name = stream.string(NAME_LENGTH);
  const frameType = stream.i32();
  const frameCount = stream.i32();
  const boneId = stream.i32();
  const hasTranslation = frameType === FRAME_TYPE_WITH_TRANSLATION;

  const frames: IfpKeyframe[] = [];
  for (let f = 0; f < frameCount; f += 1) {
    const rotation: [number, number, number, number] = [
      stream.i16() / ROTATION_SCALE,
      stream.i16() / ROTATION_SCALE,
      stream.i16() / ROTATION_SCALE,
      stream.i16() / ROTATION_SCALE,
    ];
    const time = stream.i16();
    const frame: IfpKeyframe = { rotation, time };
    if (hasTranslation) {
      frame.translation = [
        stream.i16() / TRANSLATION_SCALE,
        stream.i16() / TRANSLATION_SCALE,
        stream.i16() / TRANSLATION_SCALE,
      ];
    }
    frames.push(frame);
  }

  return { boneId, frames, name };
}
