/**
 * Device-agnostic input the game reads each tick (plan 055). One or more {@link InputState} sources
 * (keyboard today; on-screen touch / gamepad later) produce these signals; the game systems consume them
 * and never touch the DOM or key codes. Look/zoom deltas (mouse / touch drag) join the contract when the
 * camera moves onto it.
 */

/** Semantic player actions, mapped from a device by a source (e.g. {@link KeyboardSource}). `descend` (Ctrl) is
 *  the inverse of `jump`/up — used by the debug fly mode for vertical control. */
export type Action = 'descend' | 'enterExit' | 'jump' | 'run';

/** What the game reads: planar movement, held actions, and per-frame look/zoom deltas. */
export interface InputState {
  /** Per-frame look delta in device pixels (mouse move / touch drag); read-and-cleared each call. */
  consumeLook(): LookDelta;
  /** Per-frame zoom delta (wheel notches / pinch); read-and-cleared each call. */
  consumeZoom(): number;
  /** Whether a semantic action is currently held. */
  isActive(action: Action): boolean;
  /** Current planar movement intent; the consumer applies any camera-relative transform. */
  move(): MoveVector;
}

/** A look/drag delta in device pixels — mouse movement or a touch drag, accumulated per frame. */
export interface LookDelta {
  x: number;
  y: number;
}

/** Planar movement intent: each component in [-1, 1]. `x` = strafe right (+), `y` = forward (+). */
export interface MoveVector {
  x: number;
  y: number;
}
