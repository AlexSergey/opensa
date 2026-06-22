/**
 * The game variant the app boots — selects which built archive set to load (`<game>-<version>/`) and the
 * player spawn. Read from `VITE_GAME_TYPE` (Vite only exposes `VITE_`-prefixed env vars), default `original`.
 */
import { parseModelList } from './game-build/env-list';

export type GameType = 'anderius' | 'carcer' | 'gostown' | 'original' | 'original-extend';

const GAME_TYPES: readonly GameType[] = ['carcer', 'original', 'anderius', 'original-extend', 'gostown'];

function resolveGameType(): GameType {
  const configured = import.meta.env.VITE_GAME_TYPE;

  return GAME_TYPES.includes(configured as GameType) ? (configured as GameType) : 'original';
}

export const GAME_TYPE: GameType = resolveGameType();

/** Default player ped when `VITE_MAIN_CHARACTER` is unset — a stock SA ped present in any install. */
const DEFAULT_MAIN_CHARACTER = 'BMYPOL1';

/**
 * TEMPORARY (bring-your-own-files): the player ped model name, resolved via `peds.ide` (e.g. `BMYPOL1`).
 * Always set — falls back to {@link DEFAULT_MAIN_CHARACTER} when the env var is empty. See {@link VEHICLES}.
 */
export const MAIN_CHARACTER: string = import.meta.env.VITE_MAIN_CHARACTER?.trim() || DEFAULT_MAIN_CHARACTER;

/**
 * TEMPORARY: vehicle model names to make available in-game, resolved via `vehicles.ide` (e.g.
 * `VITE_VEHICLES=['admiral','comet']` or `admiral,comet`). Also included in the local loader's asset
 * selection so their DFF/TXD are pulled from the install.
 */
export const VEHICLES: string[] = parseModelList(import.meta.env.VITE_VEHICLES);
