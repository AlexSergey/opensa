/**
 * Runtime game catalogue (plan 056). Each key is a game the menu can launch; the value is its full
 * configuration — replaces the old single-game `.env` setup. Data-only, except `disclaimer` which is JSX
 * (hence `.tsx`). The selected game drives the loader, the manifest URL, and the world/player setup.
 */
import type { ReactNode } from 'react';

import type { Vec3 } from './game';
import type { VehiclePlacement } from './game/vehicle/vehicle-lod.system';
import type { AssetLoaderKind } from './loaders';

import { selectGameIds } from './game-config.select';

/** Everything needed to launch and run one game. */
export interface GameConfig {
  /** Loader: `fetch` (download chunk archives) or `local` (read a user-picked raw install). */
  assetLoader: AssetLoaderKind;
  /** Dev-only: dropped from production builds (kept under `npm run dev`). Used for `fetch` demos that would
   *  otherwise distribute mod content from the CDN — see {@link GAME_IDS}. */
  devOnly?: boolean;
  /** Greyed out in the menu when true. */
  disable?: boolean;
  /** Why the game is disabled (shown under it in the menu). */
  disabledNote?: string;
  /** Shown in a popup before launch (fetch: with an OK button; local: inside the folder prompt). */
  disclaimer: ReactNode;
  /** Menu button text. */
  label: string;
  /** Initial collision-zone radius / clock (minutes since midnight) / weather (a `WEATHER_NAMES` entry). */
  loadGame: { radius: number; startMinutes: number; weather: string };
  /** Player ped model name (resolved via `peds.ide`). */
  mainCharacter: string;
  /** Player collision-box half-extents (Z-up); defaults to the human box. */
  playerHalfExtents?: Vec3;
  /** Single source for where the player starts: seeds the capsule AND the initial collision zone. */
  playerSpawn: Vec3;
  /** Debug "Position" teleport list ([] / omitted → no Position tab). */
  teleports?: Teleport[];
  /** Vehicle model names available in-game (resolved via `vehicles.ide`). */
  vehicles: string[];
  /** Parked cars placed on load (colour = carcols.dat palette indices). */
  vehiclesSpawn?: VehiclePlacement[];
}

/** A debug "Position" teleport target (native GTA Z-up world coords). */
export interface Teleport {
  coords: Vec3;
  label: string;
}

const SA_TELEPORTS: readonly Teleport[] = [
  { coords: [2495, -1675, 16], label: 'LS - Ganton' },
  { coords: [1481.0, -1744.0, 13.5], label: 'LS - Downtown' },
  { coords: [2860.28, -1887.01, 10.86], label: 'LS - Long Beach' },
  { coords: [342.0, -1803.0, 4.8], label: 'LS - Santa Maria Beach' },
  { coords: [2020.0, 1007.0, 10.86], label: 'LV - City Center' },
  { coords: [2031.09, 1539.7, 10.74], label: 'LV - Pirate' },
  { coords: [2019.8, 1007.7, 10.86], label: 'LV - Four Dragons' },
  { coords: [1697.0, 1447.0, 10.86], label: 'LV - Airport' },
  { coords: [-1905.0, 277.0, 41.0], label: 'SF - Doherty' },
  { coords: [-1988.0, 138.0, 27.5], label: 'SF - City Center' },
  { coords: [-1420.0, -287.0, 14.1], label: 'SF - Airport' },
  { coords: [-1045.0, -1620.0, 76.4], label: "Country - Truth's Farm" },
  { coords: [-1696.8, -748.0, 100.0], label: 'Country - Flint Hills' },
  { coords: [1139.0, -1490.0, 18.5], label: 'LS - Escalators' },
];

/** A launchable game id. */
export type GameId = 'gostown' | 'original' | 'original-extend';

export const GAME_CONFIG: Record<GameId, GameConfig> = {
  gostown: {
    assetLoader: 'fetch',
    disclaimer: (
      <>
        <p>
          <strong>GosTown Paradise</strong> is a free, non-commercial community total-conversion mod, served here for a
          technical demo. Not affiliated with Rockstar Games or Take-Two.
        </p>
        <p>Game data is downloaded and cached in your browser (Cache Storage); analytics only count visitors.</p>
        <div className="sa-credits">
          <p className="sa-credits__title">The mod</p>
          <ul>
            <li>
              <a
                href="https://www.mixmods.com.br/2021/04/gostown-paradise-repack-modloader/"
                rel="noreferrer"
                target="_blank"
              >
                MixMods — Gostown Paradise repack (modloader)
              </a>
            </li>
            <li>
              <a href="https://www.moddb.com/mods/gostown-paradise-v6" rel="noreferrer" target="_blank">
                ModDB — Gostown Paradise v6
              </a>
            </li>
          </ul>
          <p className="sa-credits__title">Special thanks</p>
          <ul>
            <li>
              <strong>mad_driver</strong> — vehicles for the demo
            </li>
            <li>
              <strong>Artur$MD</strong> — player model author
            </li>
          </ul>
        </div>
      </>
    ),
    label: 'Run Gostown Paradise [web]',
    loadGame: { radius: 400, startMinutes: 360, weather: 'EXTRASUNNY_SMOG_LA' },
    mainCharacter: 'BMYPOL1',
    playerSpawn: [1531.15, -1271.89, 581.74],
    teleports: [{ coords: [1531.15, -1271.89, 581.74], label: 'Downtown' }],
    vehicles: ['admiral', 'comet'],
    vehiclesSpawn: [
      { colour: '57,57', heading: 0, model: 'admiral', position: [1528.91, -1279.5, 581.36] },
      { colour: '6,3', heading: 0, model: 'comet', position: [1534.33, -1279.93, 581.38] },
    ],
  },
  original: {
    assetLoader: 'local',
    disclaimer: (
      <>
        <p>
          <strong>GTA: San Andreas</strong> assets can&rsquo;t be shipped — play from your own legitimate copy. Select
          your installed game folder; nothing is uploaded, files are read locally in your browser.
        </p>
        <p>Analytics only count visitors.</p>
      </>
    ),
    label: 'Run San Andreas [local only]',
    loadGame: { radius: 400, startMinutes: 360, weather: 'EXTRASUNNY_SMOG_LA' },
    mainCharacter: 'BMYPOL1',
    playerSpawn: [2495, -1675, 16],
    teleports: [...SA_TELEPORTS],
    vehicles: ['admiral', 'comet'],
    vehiclesSpawn: [
      { colour: '57,57', heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
      { colour: '6,3', heading: 0, model: 'comet', position: [2493, -1678, 13.4] },
    ],
  },
  'original-extend': {
    assetLoader: 'fetch',
    devOnly: true,
    disclaimer: <div />,
    label: 'Run Extended SA [local only]',
    loadGame: { radius: 400, startMinutes: 360, weather: 'EXTRASUNNY_SMOG_LA' },
    mainCharacter: 'BMYPOL1',
    playerSpawn: [2495, -1675, 16],
    teleports: [...SA_TELEPORTS],
    vehicles: ['admiral', 'comet'],
    vehiclesSpawn: [
      { colour: '57,57', heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
      { colour: '6,3', heading: 0, model: 'comet', position: [2493, -1678, 13.4] },
    ],
  },
};

/** True in `npm run dev` (Vite serve); false in any production build. Vite statically replaces
 *  `process.env.NODE_ENV` (see `vite.config.ts`), so the dev-only games are dropped at build time. */
const IS_DEV = process.env.NODE_ENV !== 'production';

/** Launchable game ids, in menu order. `devOnly` games (fetch demos that would distribute mod content from
 *  the CDN) are dropped from production builds, so a deployed site offers only the bring-your-own-files
 *  titles (San Andreas). They remain available under `npm run dev`. */
export const GAME_IDS = selectGameIds(GAME_CONFIG, IS_DEV);

/** Default player collision-box half-extents (Z-up) — a human; per-game `playerHalfExtents` overrides it. */
export const HUMAN_HALF_EXTENTS: Vec3 = [0.3, 0.3, 0.9];
