import {
  type AnimationAction,
  AnimationClip,
  AnimationMixer,
  type Bone,
  type KeyframeTrack,
  LoopOnce,
  LoopRepeat,
  type Object3D,
} from 'three';

/**
 * Drives a character's skeleton with named animation clips via a `THREE.
 * AnimationMixer`. On construction it **retargets** each clip's tracks onto the
 * model's actual bone names (IFP names vary — `Normal` vs `Root`, `Spine 1` vs
 * `Spine1`), dropping tracks with no matching bone. `play` crossfades between
 * looping clips; `update` ticks the mixer once per frame.
 */
export class AnimationController {
  private readonly clips = new Map<string, AnimationClip>();
  private current: AnimationAction | null = null;
  private currentName: null | string = null;
  private readonly mixer: AnimationMixer;

  /** `root` must contain the named bones in its subtree (the player wrapper). */
  constructor(root: Object3D, clips: Map<string, AnimationClip>, bonesByName: Map<string, Bone>) {
    this.mixer = new AnimationMixer(root);
    for (const [name, clip] of clips) {
      this.clips.set(name.toLowerCase(), retargetClip(clip, bonesByName));
    }
  }

  /** Duration (seconds) of the named clip, or 0 if unknown. */
  duration(name: string): number {
    return this.clips.get(name.toLowerCase())?.duration ?? 0;
  }

  /** Crossfade to the named clip. `loop` false plays once and holds the last pose. No-op if current/unknown. */
  play(name: string, fade = 0.2, loop = true): void {
    const key = name.toLowerCase();
    if (this.currentName === key) {
      return;
    }
    const clip = this.clips.get(key);
    if (!clip) {
      return;
    }

    const next = this.mixer.clipAction(clip);
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    next.clampWhenFinished = !loop;
    next.reset().play();
    if (this.current && fade > 0) {
      this.current.crossFadeTo(next, fade, false);
    } else {
      this.current?.stop();
    }
    this.current = next;
    this.currentName = key;
  }

  update(delta: number): void {
    this.mixer.update(delta);
  }
}

/** Rename a clip's tracks onto a skeleton's actual bone names (drop unmatched); clip is cloned. */
export function retargetClip(clip: AnimationClip, bonesByName: Map<string, Bone>): AnimationClip {
  const resolve = boneResolver(bonesByName);
  const tracks: KeyframeTrack[] = [];
  for (const track of clip.clone().tracks) {
    const dot = track.name.lastIndexOf('.');
    const bone = resolve(track.name.slice(0, dot));
    if (bone === null) {
      continue;
    }
    track.name = `${bone}${track.name.slice(dot)}`;
    tracks.push(track);
  }

  return new AnimationClip(clip.name, clip.duration, tracks);
}

function boneResolver(bonesByName: Map<string, Bone>): (name: string) => null | string {
  const byKey = new Map<string, string>();
  for (const name of bonesByName.keys()) {
    byKey.set(normalizeBone(name), name);
  }

  return (name) => byKey.get(normalizeBone(name)) ?? null;
}

/** Canonical key so IFP bone names match the skeleton (spacing-insensitive; `Normal` = root). */
function normalizeBone(name: string): string {
  const key = name.trim().toLowerCase().replace(/\s+/g, '');

  return key === 'normal' ? 'root' : key;
}
