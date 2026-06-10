import type { TimecycItem, TimecycParsed } from '../interfaces/timecyc.interface';

import { TimecycParser } from '../parsers/timecyc';

export class TimecycManager {
  baseTimecyc: TimecycParser | undefined;

  timecycItems: TimecycItem[] = [];

  merge(): TimecycParser | undefined {
    const merged: TimecycParsed = {};
    this.baseTimecyc?.parse();
    const base = this.baseTimecyc?.getParsed();

    this.timecycItems.forEach(({ timecyc }) => {
      if (timecyc) {
        timecyc.parse();
      }
    });

    if (!base) {
      return;
    }

    Object.keys(base).forEach((w: string) => {
      const toMerge = this.timecycItems.find(({ zones }) => {
        if (zones && Array.isArray(zones)) {
          return zones?.includes(w);
        }

        return false;
      });

      // We override zones first
      if (toMerge && toMerge.timecyc) {
        merged[w] = toMerge.timecyc.getParsed()[w];

        if (toMerge.skipProps) {
          return;
        }
      } else {
        merged[w] = base[w];
      }

      Object.keys(base[w]).forEach((t: string) => {
        const toMerge = this.timecycItems.find(({ times }) => {
          if (times && Array.isArray(times)) {
            console.log(times, t, times?.includes(t));

            return times?.includes(t);
          }

          return false;
        });

        // We override time frames after we apply zone
        if (toMerge && toMerge.timecyc) {
          merged[w][t] = toMerge.timecyc.getParsed()[w][t];
        }

        Object.keys(base[w][t]).forEach((p: string) => {
          const toMerge = this.timecycItems.find(({ props }) => {
            if (props && Array.isArray(props)) {
              return props?.includes(p);
            }

            return false;
          });

          // We override some props
          if (toMerge && toMerge.timecyc) {
            merged[w][t][p] = toMerge.timecyc.getParsed()[w][t][p];
          }
        });
      });
    });

    const timecyc = new TimecycParser();
    timecyc.setParsed(merged);

    return timecyc;
  }

  async setBase(baseTimecyc: string): Promise<void> {
    this.baseTimecyc = await new TimecycParser().read(baseTimecyc);
  }

  async setTimecycToMerge(timecycToMerge: TimecycItem[]): Promise<this> {
    for (const timecyc of timecycToMerge) {
      const tc = await new TimecycParser().read(timecyc.path);

      this.timecycItems.push({
        ...timecyc,
        timecyc: tc,
      });
    }

    return this;
  }
}
