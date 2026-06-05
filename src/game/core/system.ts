/**
 * A unit of per-frame logic. `fixedUpdate` runs on a deterministic fixed step
 * (physics / ECS); `update` runs once per rendered frame. Dynamic systems
 * (streaming, physics, character) register here without touching the loop.
 */
export interface System {
  fixedUpdate?(step: number): void;
  readonly name: string;
  update?(delta: number): void;
}

export class SystemRegistry {
  private readonly systems: System[] = [];

  add(system: System): void {
    this.systems.push(system);
  }

  fixedUpdate(step: number): void {
    for (const system of this.systems) {
      system.fixedUpdate?.(step);
    }
  }

  remove(system: System): void {
    const index = this.systems.indexOf(system);
    if (index >= 0) {
      this.systems.splice(index, 1);
    }
  }

  update(delta: number): void {
    for (const system of this.systems) {
      system.update?.(delta);
    }
  }
}
