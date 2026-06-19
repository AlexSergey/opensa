/**
 * Pure boot state machine (plan 051): the shell's phases from first paint to playing, plus pause and the
 * error/retry → degraded-menu fallback. No React, no IO — the hook drives it with events from the loader.
 */

export type BootEvent =
  | { phase: LoadingPhase; type: 'FAIL' }
  | { type: 'CHOOSE_FOLDER' }
  | { type: 'CORE_LOADED' }
  | { type: 'DISCLAIMER_OK' }
  | { type: 'FOLDER_READY' }
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
  | 'folder' // local loader: bring-your-own-files prompt (pick the GTA install)
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

/**
 * TEMP kill-switch: while we rework how the game is distributed (bring-your-own-files, for a clean
 * legal setup), the playable demo is disabled — no assets download and Play is blocked. The shell
 * boots straight to the menu. Set back to `true` to restore the normal boot.
 */
export const PLAY_ENABLED = true;

export function bootReducer(state: BootState, event: BootEvent): BootState {
  switch (event.type) {
    case 'CHOOSE_FOLDER':
      // Local loader: Play → the bring-your-own-files prompt (only from a live, non-degraded menu).
      return state.phase === 'menu' && !state.degraded ? { ...state, phase: 'folder' } : state;
    case 'CORE_LOADED':
      return state.phase === 'core' ? { ...state, phase: 'menu' } : state;
    case 'DISCLAIMER_OK':
      return state.phase === 'disclaimer' ? { ...state, disclaimerAccepted: true, phase: 'textures' } : state;
    case 'FAIL':
      return { ...state, failedPhase: event.phase, phase: 'error' };
    case 'FOLDER_READY':
      // Local loader: install folder acquired (from the prompt, or straight from a ready menu) → load all.
      return state.phase === 'folder' || state.phase === 'menu' ? { ...state, phase: 'textures' } : state;
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

/**
 * Initial state. `autoLoad` (fetch loader) starts downloading `core` immediately; otherwise (local loader,
 * bring-your-own-files) it boots to the `menu` so nothing is read until the user picks their install folder.
 * `disclaimerAccepted` comes from persistence.
 */
export function initialBootState(disclaimerAccepted: boolean, autoLoad = true): BootState {
  return { degraded: false, disclaimerAccepted, failedPhase: null, phase: autoLoad ? 'core' : 'menu', retries: 0 };
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
