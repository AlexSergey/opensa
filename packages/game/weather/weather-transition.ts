/** A live weather blend: `from`/`to` timecyc indices and an eased factor `t` (1 = settled on `to`). */
export interface WeatherBlend {
  from: number;
  t: number;
  to: number;
}

/**
 * Drives smooth weather changes: instead of switching the timecyc weather instantly, it eases a blend
 * factor from the old weather to the new one over a few seconds. Generic/renderware-free — it only deals
 * with weather **indices** and the factor `t`; the sampler blends the actual colours (`sampleTimecycBlend`).
 *
 * Mid-transition retarget (switching again before a blend finishes) restarts from the nearest endpoint —
 * a small visual jump in the worst case, fine for the deliberate weather switches this is built for.
 */
export class WeatherTransition {
  /** The committed target weather (the current weather; what the UI shows as selected). */
  get target(): number {
    return this.to;
  }
  private duration = 0; // seconds; 0 = settled (no active blend)
  private elapsed = 0;
  private from: number;

  private to: number;

  constructor(initial: number) {
    this.from = initial;
    this.to = initial;
  }

  /** Begin easing to `weather` over `seconds` (≤0 = instant). No-op if already heading there. */
  begin(weather: number, seconds: number): void {
    if (weather === this.to) {
      return;
    }
    this.from = this.duration > 0 && this.elapsed / this.duration >= 0.5 ? this.to : this.from;
    this.to = weather;
    this.elapsed = 0;
    this.duration = Math.max(0, seconds);
    if (this.duration === 0) {
      this.from = weather;
    }
  }

  /** Current blend snapshot for the samplers. */
  blend(): WeatherBlend {
    if (this.duration === 0) {
      return { from: this.to, t: 1, to: this.to };
    }
    const x = Math.min(1, this.elapsed / this.duration);

    return { from: this.from, t: x * x * (3 - 2 * x), to: this.to }; // smoothstep ease-in-out
  }

  /** Advance the active blend by `delta` seconds; settles onto `to` when complete. */
  tick(delta: number): void {
    if (this.duration === 0) {
      return;
    }
    this.elapsed += delta;
    if (this.elapsed >= this.duration) {
      this.from = this.to;
      this.duration = 0;
      this.elapsed = 0;
    }
  }
}
