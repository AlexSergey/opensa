import type { Object3D } from 'three';

/** A damageable body part: an `_ok`/`_dam` mesh pair under a detachable pivot. */
export interface VehiclePart {
  /** The damaged mesh (hidden until damaged). */
  dam: Object3D;
  /** Part name without the `_ok`/`_dam` suffix (e.g. `bonnet`, `door_lf`). */
  name: string;
  /** The undamaged mesh (shown initially). */
  ok: Object3D;
  /** Group holding the part (positioned in vehicle space); detached when it falls off. */
  pivot: Object3D;
  /** Part centre in vehicle space `[x, y, z]` (for mapping a hit location to the part). */
  position: [number, number, number];
}
