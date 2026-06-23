/**
 * Pure boot state machine (plans 051 / 056): from the game menu to playing, plus pause and error/retry.
 * No React, no IO — the hook drives it with events derived from the selected game's config + the loader.
 */
import type { GameId } from '../../game-config';
import type { AssetLoaderKind } from '../../loaders';

export type BootEvent =
  | { accepted: boolean; assetLoader: AssetLoaderKind; game: GameId; type: 'SELECT' }
  | { type: 'DISCLAIMER_OK' }
  | { type: 'FAIL' }
  | { type: 'FOLDER_READY' }
  | { type: 'LOADED' }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'RETRY' }
  | { type: 'WORLD_READY' };

export type BootPhase =
  | 'disclaimer' // fetch game picked, not yet accepted → disclaimer popup (OK)
  | 'error' // the load failed; offer retry
  | 'folder' // local game picked → bring-your-own-files prompt (+ disclaimer if not accepted)
  | 'loading' // downloading / reading the selected game (one progress screen)
  | 'menu' // the game list (no game selected)
  | 'paused' // in-game, Esc → menu overlay
  | 'playing' // game visible
  | 'warmup'; // assets ready, world streaming in (waiting for world-ready)

export interface BootState {
  /** The selected game, or null on the menu. */
  game: GameId | null;
  phase: BootPhase;
  /** Retry attempts used for the current failure. */
  retries: number;
}

/** Max retry clicks before giving up and returning to the menu. */
export const MAX_RETRIES = 3;

export function bootReducer(state: BootState, event: BootEvent): BootState {
  switch (event.type) {
    case 'DISCLAIMER_OK':
      return state.phase === 'disclaimer' ? { ...state, phase: 'loading' } : state;
    case 'FAIL':
      return state.phase === 'loading' ? { ...state, phase: 'error' } : state;
    case 'FOLDER_READY':
      // Local: install folder acquired (from the prompt, or a restored grant) → start loading.
      return state.phase === 'folder' ? { ...state, phase: 'loading' } : state;
    case 'LOADED':
      return state.phase === 'loading' ? { ...state, phase: 'warmup' } : state;
    case 'PAUSE':
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'RESUME':
      return state.phase === 'paused' ? { ...state, phase: 'playing' } : state;
    case 'RETRY':
      return onRetry(state);
    case 'SELECT':
      return onSelect(state, event);
    case 'WORLD_READY':
      return state.phase === 'warmup' ? { ...state, phase: 'playing' } : state;
    default:
      return state;
  }
}

/** Fresh menu state — no game selected. */
export function initialBootState(): BootState {
  return { game: null, phase: 'menu', retries: 0 };
}

/** Retry: re-enter loading until the budget is spent, then drop back to the menu. */
function onRetry(state: BootState): BootState {
  if (state.phase !== 'error') {
    return state;
  }

  return state.retries >= MAX_RETRIES ? initialBootState() : { ...state, phase: 'loading', retries: state.retries + 1 };
}

/** Pick a game from the menu: local always routes through the folder prompt; fetch skips the disclaimer
 *  once it has been accepted. */
function onSelect(state: BootState, event: Extract<BootEvent, { type: 'SELECT' }>): BootState {
  if (state.phase !== 'menu') {
    return state;
  }
  const phase: BootPhase = event.assetLoader === 'local' ? 'folder' : event.accepted ? 'loading' : 'disclaimer';

  return { game: event.game, phase, retries: 0 };
}
