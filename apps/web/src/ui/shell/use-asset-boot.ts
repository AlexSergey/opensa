import type { AssetLoader, ProgressSnapshot } from '@opensa/loaders';
import type { AssetFileSystem } from '@opensa/renderware';

import { createAssetLoader } from '@opensa/loaders';
import { withModloader } from '@opensa/modloader';
import { Vfs } from '@opensa/vfs';
import { type ReactNode, useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { BootState } from './boot-machine';

import { GAME_CONFIG, type GameId } from '../../game-config';
import { bootReducer, initialBootState } from './boot-machine';
import { rotatingStatus, TEXTURE_STATUS, toPercent } from './boot-status';
import { isDisclaimerAccepted, rememberDisclaimerAccepted } from './boot-storage';

const BASE = import.meta.env.VITE_STATIC_URL;
const NO_PROGRESS: ProgressSnapshot = { loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 };
const STATUS_INTERVAL_MS = 3600;

/** The shell's boot controller: drives the per-game loader/VFS by phase and exposes state + actions. */
export interface AssetBoot {
  acceptDisclaimer: () => void;
  /** Prompt for the install folder (local loader, user gesture) — unblocks loading. */
  chooseFolder: () => void;
  /** Last error message (for the error panel). */
  detail: string;
  /** The selected game's disclaimer (popup / folder prompt); null on the menu. */
  disclaimer: null | ReactNode;
  /** Whether the selected game's disclaimer was already accepted (the folder prompt hides it then). */
  disclaimerAccepted: boolean;
  /** The asset file system the game reads from (filled as the load completes). */
  fs: AssetFileSystem;
  pause: () => void;
  /** Active-load progress, 0–100. */
  percent: number;
  /** Launch a game from the menu. */
  play: (game: GameId) => void;
  resume: () => void;
  retry: () => void;
  state: BootState;
  /** Rotating status line for the preloader. */
  status: string;
  worldReady: () => void;
}

/** One game's loader + VFS, created when the game is selected. */
interface Session {
  loader: AssetLoader;
  vfs: Vfs;
}

export function useAssetBoot(): AssetBoot {
  const [state, dispatch] = useReducer(bootReducer, undefined, initialBootState);
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(NO_PROGRESS);
  const [tick, setTick] = useState(0);
  const [detail, setDetail] = useState('');
  const attemptRef = useRef(''); // `${game}:${retries}` — runs the load once per attempt (retry/StrictMode-safe)

  // A fresh loader + VFS per selected game (null on the menu). The empty fallback VFS is only read before a
  // game is chosen (the game canvas mounts at warmup, when the session exists).
  const fallbackVfs = useMemo(() => new Vfs(), []);
  const session = useMemo<null | Session>(() => {
    if (!state.game) {
      return null;
    }
    const config = GAME_CONFIG[state.game];
    const vfs = new Vfs();
    const loader = createAssetLoader({
      assetLoader: config.assetLoader,
      game: state.game,
      manifestUrl: `${BASE}/games/${state.game}-${__APP_VERSION__}/manifest.json`,
      sink: vfs,
      version: __APP_VERSION__,
    });

    return { loader, vfs };
  }, [state.game]);

  // Wrap the VFS with the modloader overlay once it's fully loaded (phase `warmup`+) — the game canvas only
  // mounts then, and the scan needs the complete `modloader/` tree. Computed once per loaded session (stable ref).
  const loaded = state.phase === 'warmup' || state.phase === 'playing' || state.phase === 'paused';
  const fs = useMemo<AssetFileSystem>(() => {
    const vfs = session?.vfs ?? fallbackVfs;

    return loaded ? withModloader(vfs) : vfs;
  }, [session, fallbackVfs, loaded]);

  // Stream active-load progress into state.
  useEffect(() => session?.loader.events.on('progress', setSnapshot), [session]);

  // Local loader: boot-time restore (no gesture). If the remembered folder is still granted AND the disclaimer
  // was accepted, skip the prompt and load straight away.
  useEffect(() => {
    if (!session?.loader.restore || state.phase !== 'folder' || !state.game) {
      return;
    }
    const game = state.game;
    let cancelled = false;
    void session.loader
      .restore()
      .then(() => {
        if (!cancelled && session.loader.ready?.() && isDisclaimerAccepted(game)) {
          dispatch({ type: 'FOLDER_READY' });
        }
      })
      .catch(() => undefined);

    return (): void => {
      cancelled = true;
    };
  }, [session, state.phase, state.game]);

  // Run the load once per attempt: init (manifest / scan) → load every group (one screen) → verify.
  useEffect(() => {
    if (state.phase !== 'loading' || !session) {
      return;
    }
    const key = `${state.game}:${state.retries}`;
    if (attemptRef.current === key) {
      return;
    }
    attemptRef.current = key;
    setSnapshot(NO_PROGRESS); // eslint-disable-line @eslint-react/set-state-in-effect -- reset per attempt

    const run = async (): Promise<void> => {
      const manifest = await session.loader.init();
      await session.loader.load();
      const problems = session.vfs.verify(manifest);
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
      dispatch({ type: 'LOADED' });
    };

    void run().catch((error: unknown) => {
      setDetail(String(error));
      dispatch({ type: 'FAIL' });
    });
  }, [state.phase, state.game, state.retries, session]);

  // Rotate the preloader status text while loading.
  useEffect(() => {
    if (state.phase !== 'loading') {
      return;
    }
    const id = setInterval(() => setTick((value) => value + 1), STATUS_INTERVAL_MS);

    return (): void => clearInterval(id);
  }, [state.phase]);

  return {
    acceptDisclaimer: useCallback((): void => {
      if (state.game) {
        rememberDisclaimerAccepted(state.game);
      }
      dispatch({ type: 'DISCLAIMER_OK' });
    }, [state.game]),
    // Local loader, from the folder screen: prompt for the install folder (the picker must run in this click —
    // its user gesture). On success the disclaimer counts as accepted and loading begins.
    chooseFolder: useCallback((): void => {
      const active = session;
      const game = state.game;
      if (!active || !game) {
        return;
      }
      void (async (): Promise<void> => {
        try {
          await active.loader.prepare?.();
          rememberDisclaimerAccepted(game);
          dispatch({ type: 'FOLDER_READY' });
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setDetail(String(error));
          }
        }
      })();
    }, [session, state.game]),
    detail,
    disclaimer: state.game ? GAME_CONFIG[state.game].disclaimer : null,
    disclaimerAccepted: state.game ? isDisclaimerAccepted(state.game) : false,
    fs,
    pause: useCallback((): void => dispatch({ type: 'PAUSE' }), []),
    percent: toPercent(snapshot),
    play: useCallback((game: GameId): void => {
      dispatch({
        accepted: isDisclaimerAccepted(game),
        assetLoader: GAME_CONFIG[game].assetLoader,
        game,
        type: 'SELECT',
      });
    }, []),
    resume: useCallback((): void => dispatch({ type: 'RESUME' }), []),
    retry: useCallback((): void => {
      setDetail('');
      dispatch({ type: 'RETRY' });
    }, []),
    state,
    status: rotatingStatus(TEXTURE_STATUS, tick),
    worldReady: useCallback((): void => dispatch({ type: 'WORLD_READY' }), []),
  };
}
