import type { System } from '../core/system';
import type { VehicleRig } from './vehicle-rig';

/** Per-frame updater for every vehicle rig (wheel spin/steer). */
export class VehicleSystem implements System {
  readonly name = 'vehicle';

  private readonly rigs: VehicleRig[] = [];

  add(rig: VehicleRig): void {
    this.rigs.push(rig);
  }

  update(delta: number): void {
    for (const rig of this.rigs) {
      rig.update(delta);
    }
  }
}
