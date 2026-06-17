/**
 * The game variant the app boots — selects which built archive set to load (`<game>-<version>/`) and the
 * player spawn. Read from `VITE_GAME_TYPE` (Vite only exposes `VITE_`-prefixed env vars), default `original`.
 */
export type GameType = 'anderius' | 'carcer' | 'original' | 'original-extend';

const GAME_TYPES: readonly GameType[] = ['carcer', 'original', 'anderius', 'original-extend'];

function resolveGameType(): GameType {
  const configured = import.meta.env.VITE_GAME_TYPE;

  return GAME_TYPES.includes(configured as GameType) ? (configured as GameType) : 'original';
}

export const GAME_TYPE: GameType = resolveGameType();
