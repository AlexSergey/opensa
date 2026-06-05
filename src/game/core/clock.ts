/** Per-frame timing. `delta`/`elapsed` are seconds; large gaps (tab switch) are clamped. */
export class Clock {
  delta = 0;
  elapsed = 0;

  private last = 0;

  tick(now: number): number {
    if (this.last === 0) {
      this.last = now;
    }
    this.delta = Math.min((now - this.last) / 1000, 0.1);
    this.elapsed += this.delta;
    this.last = now;

    return this.delta;
  }
}
