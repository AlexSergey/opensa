import type { ControlsConfig } from '../../interfaces/config.interface';
import type { Action, InputState, LookDelta, MoveVector } from '../input-state';
import type { KeyboardInput } from './keyboard';

/** Enter/exit-vehicle key — not part of the remappable movement bindings yet (was a constant in the system). */
const ENTER_VEHICLE_KEY = 'Enter';
/** Descend key (fly-mode down) — either Control; not a remappable binding (debug-only, like enter/exit). */
const DESCEND_KEYS = ['ControlLeft', 'ControlRight'];

/**
 * Translates held keyboard keys into the device-agnostic {@link InputState} the game reads. The key-code
 * bindings ({@link ControlsConfig}) live here, in the source, instead of being baked into the systems —
 * so a touch / gamepad source can produce the same signals (plan 055).
 */
export class KeyboardSource implements InputState {
  constructor(
    private readonly keyboard: KeyboardInput,
    private readonly controls: ControlsConfig,
  ) {}

  /** A keyboard has no look axis. */
  consumeLook(): LookDelta {
    return { x: 0, y: 0 };
  }

  /** A keyboard has no zoom axis. */
  consumeZoom(): number {
    return 0;
  }

  isActive(action: Action): boolean {
    switch (action) {
      case 'descend':
        return DESCEND_KEYS.some((key) => this.keyboard.isDown(key));
      case 'enterExit':
        return this.keyboard.isDown(ENTER_VEHICLE_KEY);
      case 'jump':
        return this.keyboard.isDown(this.controls.jump);
      case 'run':
        return this.controls.run !== undefined && this.keyboard.isDown(this.controls.run);
    }
  }

  move(): MoveVector {
    return {
      x: this.axis(this.controls.right, this.controls.left),
      y: this.axis(this.controls.forward, this.controls.back),
    };
  }

  private axis(positive: string, negative: string): number {
    return (this.keyboard.isDown(positive) ? 1 : 0) - (this.keyboard.isDown(negative) ? 1 : 0);
  }
}
