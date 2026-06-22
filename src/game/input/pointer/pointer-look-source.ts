import type { InputState, LookDelta, MoveVector } from '../input-state';

/**
 * Mouse look/zoom as an {@link InputState} source (plan 055): accumulates `pointermove` deltas into a look
 * vector and `wheel` into a zoom delta, both read-and-cleared per frame by the camera. It contributes no
 * movement or actions — those come from other sources (keyboard / touch). The camera applies its own
 * per-mode sensitivity, so the deltas are raw device pixels / wheel units.
 */
export class PointerLookSource implements InputState {
  private lookX = 0;
  private lookY = 0;
  private zoom = 0;

  constructor(private readonly target: HTMLElement) {}

  consumeLook(): LookDelta {
    const delta = { x: this.lookX, y: this.lookY };
    this.lookX = 0;
    this.lookY = 0;

    return delta;
  }

  consumeZoom(): number {
    const delta = this.zoom;
    this.zoom = 0;

    return delta;
  }

  /** The pointer contributes no held actions. */
  isActive(): boolean {
    return false;
  }

  /** The pointer contributes no planar movement. */
  move(): MoveVector {
    return { x: 0, y: 0 };
  }

  start(): void {
    this.target.addEventListener('pointermove', this.onPointerMove);
    this.target.addEventListener('wheel', this.onWheel, { passive: false });
  }

  stop(): void {
    this.target.removeEventListener('pointermove', this.onPointerMove);
    this.target.removeEventListener('wheel', this.onWheel);
    this.lookX = 0;
    this.lookY = 0;
    this.zoom = 0;
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (event.pointerType === 'touch') {
      return; // touch look comes from the on-screen joystick (TouchInputSource), not raw canvas drags
    }
    this.lookX += event.movementX;
    this.lookY += event.movementY;
  };

  private readonly onWheel = (event: WheelEvent): void => {
    event.preventDefault(); // the canvas owns the wheel — don't scroll the page
    this.zoom += event.deltaY;
  };
}
