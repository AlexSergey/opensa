import type { System } from '../core/system';
import type { Vec3 } from '../interfaces/world-adapter.interface';

/** A named `info.zon` zone: its GXT-key name + 2D world AABB. */
export interface NamedZone {
  max: [number, number];
  min: [number, number];
  name: string;
}

/**
 * Tracks the district (`info.zon` zone) the player is in and calls `onChange(zoneKey)` when it changes. SA
 * shows the **smallest** containing zone (a district inside a county inside an island), so the boxes are sorted
 * by area and the first one containing the point wins. `onChange` gets the zone's GXT **key** (e.g. `LMEX`);
 * the caller resolves it to display text via the GXT. Empty string is sent when the player is in no zone.
 */
export class ZoneNameSystem implements System {
  readonly name = 'zone-name';

  private current: null | string = null;
  private readonly onChange: (zoneKey: string) => void;
  private readonly position: () => Vec3;
  private readonly zones: readonly NamedZone[];

  constructor(zones: readonly NamedZone[], position: () => Vec3, onChange: (zoneKey: string) => void) {
    // Smallest-area first → the first box containing the point is the most specific district.
    this.zones = [...zones].sort((a, b) => area(a) - area(b));
    this.position = position;
    this.onChange = onChange;
  }

  update(): void {
    const [x, y] = this.position();
    let key = '';
    for (const zone of this.zones) {
      if (x >= zone.min[0] && x <= zone.max[0] && y >= zone.min[1] && y <= zone.max[1]) {
        key = zone.name;
        break;
      }
    }
    if (key !== this.current) {
      this.current = key;
      this.onChange(key);
    }
  }
}

function area(zone: NamedZone): number {
  return (zone.max[0] - zone.min[0]) * (zone.max[1] - zone.min[1]);
}
