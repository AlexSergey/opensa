import type { Action, InputState, LookDelta, MoveVector } from './input-state';

/**
 * Merges several {@link InputState} sources (keyboard, pointer, touch …) into one the game reads (plan 055):
 * actions OR together, move vectors sum (clamped to [-1, 1]), look/zoom deltas accumulate across sources.
 * Sources can be added after construction (the keyboard is wired once the player is set up).
 */
export class CombinedInput implements InputState {
  private readonly sources: InputState[];

  constructor(sources: readonly InputState[] = []) {
    this.sources = [...sources];
  }

  /** Register another source (e.g. the keyboard, once the character exists). */
  add(source: InputState): void {
    this.sources.push(source);
  }

  consumeLook(): LookDelta {
    let x = 0;
    let y = 0;
    for (const source of this.sources) {
      const delta = source.consumeLook();
      x += delta.x;
      y += delta.y;
    }

    return { x, y };
  }

  consumeZoom(): number {
    let zoom = 0;
    for (const source of this.sources) {
      zoom += source.consumeZoom();
    }

    return zoom;
  }

  isActive(action: Action): boolean {
    return this.sources.some((source) => source.isActive(action));
  }

  move(): MoveVector {
    let x = 0;
    let y = 0;
    for (const source of this.sources) {
      const vector = source.move();
      x += vector.x;
      y += vector.y;
    }

    return { x: clamp(x), y: clamp(y) };
  }
}

/** Clamp a summed axis to the [-1, 1] intent range. */
function clamp(value: number): number {
  return Math.min(Math.max(value, -1), 1);
}
