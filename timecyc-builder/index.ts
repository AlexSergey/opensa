import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { TimecycManager } from './core/timecyc-manager';

const init = async (): Promise<void> => {
  const manager = new TimecycManager();
  await manager.setBase(resolve(__dirname, './base/Modern Fusion Timecyc.dat'));
  await manager.setTimecycToMerge([
    {
      path: resolve(__dirname, './merge/Real Linear Graphic 2.6.dat'),
      zones: ['CLOUDY_VEGAS'],
    },
    {
      path: resolve(__dirname, './merge/Real Linear Graphic 2.6.dat'),
      zones: ['CLOUDY_SF'],
    },
    {
      path: resolve(__dirname, './merge/Real Linear Graphic 2.6.dat'),
      skipProps: true,
      zones: ['FOGGY_SF'],
    },
    {
      path: resolve(__dirname, './merge/Real Linear Graphic 2.6.dat'),
      zones: ['CLOUDY_LA'],
    },
    {
      path: resolve(__dirname, "./merge/24h TimeCycle gtadrive's Atmosphere Simulation+long night.dat"),
      props: ['Sky top', 'Sky bot'],
      times: ['20h', '21h', '22h', '23h', '0h', '1h', '2h', '3h', '4h', '5h'],
    },
    {
      path: resolve(__dirname, './merge/Real Linear Graphic 2.6.dat'),
      props: ['Sky top', 'Sky bot'],
    },
    {
      path: resolve(__dirname, './merge/original_24.dat'),
      props: ['WaterRGBA'],
    },
  ]);
  const merged = manager.merge();
  if (merged) {
    const str = merged.stringify();
    if (str) {
      await writeFile(join(__dirname, 'merged', 'timecyc_24h.dat'), str, 'utf8');
    }
  }
};

void init();
