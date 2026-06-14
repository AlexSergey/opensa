import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { TimecycManager } from './core/timecyc-manager';

const gameDataFolder = join(__dirname, '..', 'game-src', 'original', 'data');

const init = async (): Promise<void> => {
  const manager = new TimecycManager();
  await manager.setBase(join(gameDataFolder, 'timecyc.dat')); // original timecyc (not 24h)
  await manager.setTimecycToMerge([
    {
      path: resolve(__dirname, './merge/RealVision_Enhanced.dat'), // not 24h
      props: ['Amb', 'Amb_Obj', 'Sky top', 'Sky bot'],
      times: ['19h', '20h', '21h', '22h', '23h', '0h', '1h', '2h', '3h', '4h', '5h'],
    },
    {
      path: resolve(__dirname, './merge/RealVision_Enhanced.dat'), // not 24h
      zones: ['CLOUDY_LA'],
    },
  ]);
  await writeFile(join(gameDataFolder, 'timecyc_24h.dat'), manager.merge(), 'utf8');
};

void init();
