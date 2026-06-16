/**
 * The game variant the app boots — selects which built archive set to load (`<game>-<version>/`) and the
 * player spawn. Read from `VITE_GAME_TYPE` (Vite only exposes `VITE_`-prefixed env vars), default `original`.
 */
export type GameType = 'carcer' | 'original';

const GAME_TYPES: readonly GameType[] = ['carcer', 'original'];

function resolveGameType(): GameType {
  const configured = import.meta.env.VITE_GAME_TYPE;

  return GAME_TYPES.includes(configured as GameType) ? (configured as GameType) : 'original';
}

export const GAME_TYPE: GameType = resolveGameType();
