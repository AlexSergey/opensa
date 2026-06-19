/**
 * The game variant the app boots — selects which built archive set to load (`<game>-<version>/`) and the
 * player spawn. Read from `VITE_GAME_TYPE` (Vite only exposes `VITE_`-prefixed env vars), default `original`.
 */
import { parseModelList } from './game-build/env-list';

export type GameType = 'anderius' | 'carcer' | 'original' | 'original-extend';

const GAME_TYPES: readonly GameType[] = ['carcer', 'original', 'anderius', 'original-extend'];

function resolveGameType(): GameType {
  const configured = import.meta.env.VITE_GAME_TYPE;

  return GAME_TYPES.includes(configured as GameType) ? (configured as GameType) : 'original';
}

export const GAME_TYPE: GameType = resolveGameType();

/**
 * TEMPORARY (bring-your-own-files): the player ped model name, resolved via `peds.ide` (e.g. `BMYPOL1`).
 * Unset → the loose `player/*.dff` fallback is used. See {@link VEHICLES}.
 */
export const MAIN_CHARACTER: string | undefined = import.meta.env.VITE_MAIN_CHARACTER?.trim() || undefined;

/**
 * TEMPORARY: vehicle model names to make available in-game, resolved via `vehicles.ide` (e.g.
 * `VITE_VEHICLES=['admiral','comet']` or `admiral,comet`). Also included in the local loader's asset
 * selection so their DFF/TXD are pulled from the install.
 */
export const VEHICLES: string[] = parseModelList(import.meta.env.VITE_VEHICLES);
