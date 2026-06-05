/** Minimal read interface a system needs: is a key (by `KeyboardEvent.code`) held. */
export interface KeyboardInput {
  isDown(code: string): boolean;
}

/**
 * Tracks which keys are held, by `KeyboardEvent.code`, from window events.
 * Systems read it through {@link KeyboardInput} so they can be unit-tested with
 * a stub (no DOM).
 */
export class Keyboard implements KeyboardInput {
  private readonly pressed = new Set<string>();

  isDown(code: string): boolean {
    return this.pressed.has(code);
  }

  start(): void {
    window.addEventListener('keydown', this.onDown);
    window.addEventListener('keyup', this.onUp);
  }

  stop(): void {
    window.removeEventListener('keydown', this.onDown);
    window.removeEventListener('keyup', this.onUp);
    this.pressed.clear();
  }

  private readonly onDown = (event: KeyboardEvent): void => {
    this.pressed.add(event.code);
  };

  private readonly onUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.code);
  };
}
