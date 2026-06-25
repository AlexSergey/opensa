import type { Action, InputState, LookDelta, MoveVector } from '../input-state';

/** Move-joystick deflection past which the player runs (no separate run button). */
const RUN_THRESHOLD = 0.85;
/** Look-joystick gain: pixel-equivalent look delta per frame at full deflection (the camera applies its own
 *  sensitivity, like a mouse). Frame-based to match {@link PointerLookSource}; tune for feel. */
const LOOK_GAIN = 10;

/**
 * On-screen touch controls as an {@link InputState} source (plan 055). The React overlay (`src/ui/controls/`)
 * drives it via the setters — a movement joystick, a look joystick, and action buttons — and the game reads it
 * through the shared {@link CombinedInput}, merged with keyboard/mouse. Headless (no DOM/React) so it is
 * unit-testable; values are screen-space (`x` right+, `y` down+) — the consumer inverts where needed.
 */
export class TouchInputSource implements InputState {
  private lookRateX = 0;
  private lookRateY = 0;
  private moveX = 0;
  private moveY = 0;
  private readonly pressed = new Set<Action>();
  private zoomAccum = 0;

  /** Add a zoom delta (pinch) — accumulated until the camera reads it. */
  addZoom(delta: number): void {
    this.zoomAccum += delta;
  }

  /** Look delta for this frame from the look joystick's current deflection (not cleared — it holds). */
  consumeLook(): LookDelta {
    return { x: this.lookRateX * LOOK_GAIN, y: this.lookRateY * LOOK_GAIN };
  }

  consumeZoom(): number {
    const zoom = this.zoomAccum;
    this.zoomAccum = 0;

    return zoom;
  }

  isActive(action: Action): boolean {
    if (action === 'run') {
      return Math.hypot(this.moveX, this.moveY) > RUN_THRESHOLD; // full move deflection = run
    }

    return this.pressed.has(action);
  }

  move(): MoveVector {
    return { x: this.moveX, y: this.moveY };
  }

  /** Set/clear an action from a button press. */
  setAction(action: Action, held: boolean): void {
    if (held) {
      this.pressed.add(action);
    } else {
      this.pressed.delete(action);
    }
  }

  /** Current look-joystick deflection in [-1, 1] (screen-space; `0,0` on release). */
  setLookRate(x: number, y: number): void {
    this.lookRateX = x;
    this.lookRateY = y;
  }

  /** Current move-joystick deflection in [-1, 1] (`x` right+, `y` forward+). */
  setMove(x: number, y: number): void {
    this.moveX = x;
    this.moveY = y;
  }
}
