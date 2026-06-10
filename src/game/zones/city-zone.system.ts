import type { System } from '../core/system';
import type { Vec3 } from '../interfaces/world-adapter.interface';
import type { City, CityBox } from './city';

import { cityAt } from './city';

/**
 * Tracks which city (Los Santos / San Fierro / Las Venturas / Countryside) the player is in, from their world
 * position and the `map.zon` boxes. Calls `onChange` whenever the city changes — including once on the first
 * update, so the initial city is known — which the game layer uses to update state + (later) cross-fade the
 * weather for that city. One cheap AABB scan per frame.
 */
export class CityZoneSystem implements System {
  readonly name = 'city-zone';

  private readonly boxes: readonly CityBox[];
  private current: City | null = null;
  private readonly onChange: (city: City) => void;
  private readonly position: () => Vec3;

  constructor(boxes: readonly CityBox[], position: () => Vec3, onChange: (city: City) => void) {
    this.boxes = boxes;
    this.position = position;
    this.onChange = onChange;
  }

  update(): void {
    const [x, y] = this.position();
    const city = cityAt(x, y, this.boxes);
    if (city !== this.current) {
      this.current = city;
      this.onChange(city);
    }
  }
}
