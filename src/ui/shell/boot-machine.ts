/**
 * Pure boot state machine (plan 051): the shell's phases from first paint to playing, plus pause and the
 * error/retry → degraded-menu fallback. No React, no IO — the hook drives it with events from the loader.
 */

export type BootEvent =
  | { phase: LoadingPhase; type: 'FAIL' }
  | { type: 'CORE_LOADED' }
  | { type: 'DISCLAIMER_OK' }
  | { type: 'PAUSE' }
  | { type: 'PLAY' }
  | { type: 'RESUME' }
  | { type: 'RETRY' }
  | { type: 'TEXTURES_LOADED' }
  | { type: 'WORLD_READY' };

export type BootPhase =
  | 'core' // downloading priority + models (intro animation)
  | 'disclaimer' // first-time Play popup
  | 'error' // a load failed; offer retry
  | 'menu' // priority + models ready
  | 'paused' // in-game, Esc → menu overlay
  | 'playing' // game visible
  | 'textures' // downloading textures
  | 'warmup'; // assets ready, world streaming in (waiting for world-ready)

export interface BootState {
  /** Play is disabled (retries exhausted) — other menu items still work. */
  degraded: boolean;
  /** Disclaimer already accepted (persisted), so Play skips straight to textures. */
  disclaimerAccepted: boolean;
  /** Which loading phase failed (to retry), or null. */
  failedPhase: LoadingPhase | null;
  phase: BootPhase;
  /** Retry attempts used for the current failure. */
  retries: number;
}

/** The phases that actually download (and can fail → retry). */
export type LoadingPhase = 'core' | 'textures';

/** Max retry clicks before the menu degrades (Play disabled). */
export const MAX_RETRIES = 3;

export function bootReducer(state: BootState, event: BootEvent): BootState {
  switch (event.type) {
    case 'CORE_LOADED':
      return state.phase === 'core' ? { ...state, phase: 'menu' } : state;
    case 'DISCLAIMER_OK':
      return state.phase === 'disclaimer' ? { ...state, disclaimerAccepted: true, phase: 'textures' } : state;
    case 'FAIL':
      return { ...state, failedPhase: event.phase, phase: 'error' };
    case 'PAUSE':
      return state.phase === 'playing' ? { ...state, phase: 'paused' } : state;
    case 'PLAY':
      return onPlay(state);
    case 'RESUME':
      return state.phase === 'paused' ? { ...state, phase: 'playing' } : state;
    case 'RETRY':
      return onRetry(state);
    case 'TEXTURES_LOADED':
      return state.phase === 'textures' ? { ...state, phase: 'warmup' } : state;
    case 'WORLD_READY':
      return state.phase === 'warmup' ? { ...state, phase: 'playing' } : state;
    default:
      return state;
  }
}

/** Initial state — always starts loading core; `disclaimerAccepted` comes from persistence. */
export function initialBootState(disclaimerAccepted: boolean): BootState {
  return { degraded: false, disclaimerAccepted, failedPhase: null, phase: 'core', retries: 0 };
}

/** Play: only from the (non-degraded) menu; first time routes through the disclaimer. */
function onPlay(state: BootState): BootState {
  if (state.phase !== 'menu' || state.degraded) {
    return state;
  }

  return { ...state, phase: state.disclaimerAccepted ? 'textures' : 'disclaimer' };
}

/** Retry: re-enter the failed phase until the budget is spent, then degrade the menu. */
function onRetry(state: BootState): BootState {
  if (state.phase !== 'error' || state.failedPhase === null) {
    return state;
  }
  if (state.retries >= MAX_RETRIES) {
    return { ...state, degraded: true, failedPhase: null, phase: 'menu' };
  }

  return { ...state, failedPhase: null, phase: state.failedPhase, retries: state.retries + 1 };
}
