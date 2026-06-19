import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import type { Manifest, ProgressSnapshot } from '../../loaders';
import type { AssetFileSystem } from '../../renderware';
import type { BootState } from './boot-machine';

import { GAME_TYPE, MAIN_CHARACTER, VEHICLES } from '../../game-config';
import { createAssetLoader, GROUP_NAMES } from '../../loaders';
import { Vfs } from '../../vfs';
import { bootReducer, initialBootState, PLAY_ENABLED } from './boot-machine';
import { CORE_STATUS, rotatingStatus, TEXTURE_STATUS, toPercent } from './boot-status';
import { readBootFlags, rememberDisclaimerAccepted, rememberIntroSeen } from './boot-storage';

const BASE = import.meta.env.VITE_STATIC_URL;
// Game archives live under static/games/<game>-<version>/ (gitignored); static/viewer/ is committed.
const MANIFEST_URL = `${BASE}/games/${GAME_TYPE}-${__APP_VERSION__}/manifest.json`;
const NO_PROGRESS: ProgressSnapshot = { loadedBytes: 0, loadedChunks: 0, totalBytes: 0, totalChunks: 0 };
const STATUS_INTERVAL_MS = 3600;
// First-visit intro: kick the logo animation at the progress midpoint; hold the menu until it finishes.
const INTRO_TRIGGER_PERCENT = 50;
const INTRO_DURATION_MS = 3400;

/** The shell's boot controller: drives the loader/VFS by phase and exposes state + actions for the UI. */
export interface AssetBoot {
  acceptDisclaimer: () => void;
  /** Prompt for the install folder (local loader, user gesture) — unblocks loading. No-op for fetch. */
  chooseFolder: () => void;
  /** Last error message (for the error panel). */
  detail: string;
  /** The asset file system the game reads from (filled as phases complete). */
  fs: AssetFileSystem;
  /** First-visit intro animation has begun (logo moves up + reveals title/description). */
  introStarted: boolean;
  pause: () => void;
  /** Active-phase progress, 0–100. */
  percent: number;
  play: () => void;
  resume: () => void;
  retry: () => void;
  state: BootState;
  /** Rotating status line for the preloader. */
  status: string;
  worldReady: () => void;
}

export function useAssetBoot(): AssetBoot {
  const flags = useMemo(() => readBootFlags(), []);

  const vfs = useMemo(() => new Vfs(), []);
  const loader = useMemo(
    () =>
      createAssetLoader({
        game: GAME_TYPE,
        manifestUrl: MANIFEST_URL,
        peds: MAIN_CHARACTER ? [MAIN_CHARACTER] : [],
        sink: vfs,
        vehicles: VEHICLES,
        version: __APP_VERSION__,
      }),
    [vfs],
  );
  // The local loader (bring-your-own-files) can't read anything until the user picks the install folder (a
  // gesture), so it boots to the menu and loads only after the folder prompt. The fetch loader has no
  // `prepare`, so it's ready immediately and auto-loads `core` on mount.
  const requiresGesture = typeof loader.prepare === 'function';
  const [folderReady, setFolderReady] = useState(!requiresGesture);

  // While the playable demo is disabled, boot straight to a Play-disabled menu so nothing downloads.
  const [state, dispatch] = useReducer(bootReducer, flags.disclaimerAccepted, (accepted) =>
    PLAY_ENABLED
      ? initialBootState(accepted, !requiresGesture)
      : ({
          degraded: true,
          disclaimerAccepted: accepted,
          failedPhase: null,
          phase: 'menu',
          retries: 0,
        } satisfies BootState),
  );
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(NO_PROGRESS);
  const [tick, setTick] = useState(0);
  const [detail, setDetail] = useState('');
  // Intro orchestration (first visit only — a repeat visitor jumps straight to the subtitled logo + menu).
  const [coreReady, setCoreReady] = useState(false);
  const [introStarted, setIntroStarted] = useState(flags.introSeen);
  const [introDone, setIntroDone] = useState(flags.introSeen);
  const percent = toPercent(snapshot);

  const manifestRef = useRef<Manifest | null>(null);
  const attemptRef = useRef(''); // `${phase}:${retries}` — runs each loading phase once per attempt

  // Stream active-phase progress into state.
  useEffect(() => {
    return loader.events.on('progress', setSnapshot);
  }, [loader]);

  // Boot-time restore (no user gesture): if the remembered folder is still granted, mark ready so loading
  // proceeds without prompting. No-op for the fetch loader. Best-effort — failures just leave it not-ready.
  useEffect(() => {
    if (!loader.restore) {
      return;
    }
    let cancelled = false;
    void loader
      .restore()
      .then(() => {
        if (!cancelled && loader.ready?.()) {
          setFolderReady(true);
        }
      })
      .catch(() => undefined);

    return (): void => {
      cancelled = true;
    };
  }, [loader]);

  // Run the active loading phase (core = priority+models, textures), once per attempt (retry/StrictMode-safe).
  useEffect(() => {
    const { phase, retries } = state;
    if (phase !== 'core' && phase !== 'textures') {
      return;
    }
    if (!folderReady) {
      return; // local loader: wait for the install-folder gesture before reading anything
    }
    const key = `${phase}:${retries}`;
    if (attemptRef.current === key) {
      return;
    }
    attemptRef.current = key;
    /* eslint-disable @eslint-react/set-state-in-effect -- reset progress/ready when a new phase begins */
    setSnapshot(NO_PROGRESS);
    if (phase === 'core') {
      setCoreReady(false);
    }
    /* eslint-enable @eslint-react/set-state-in-effect */

    const runCore = async (): Promise<void> => {
      manifestRef.current ??= await loader.init();
      await loader.load(['priority', 'models']);
      rememberIntroSeen();
      setCoreReady(true); // the menu waits for the intro animation too (see below)
    };
    const runTextures = async (): Promise<void> => {
      // Fetch already loaded core (priority+models); local skipped it, so it loads everything here.
      manifestRef.current ??= await loader.init();
      await loader.load(requiresGesture ? GROUP_NAMES : ['textures']);
      const problems = vfs.verify(manifestRef.current);
      if (problems.length > 0) {
        throw new Error(problems.join('; '));
      }
      dispatch({ type: 'TEXTURES_LOADED' });
    };

    void (phase === 'core' ? runCore() : runTextures()).catch((error: unknown) => {
      setDetail(String(error));
      dispatch({ phase, type: 'FAIL' });
    });
  }, [loader, vfs, state, folderReady, requiresGesture]);

  // Start the intro animation at the progress midpoint (or once core is in, whichever comes first).
  useEffect(() => {
    if (!introStarted && state.phase === 'core' && (percent >= INTRO_TRIGGER_PERCENT || coreReady)) {
      // eslint-disable-next-line @eslint-react/set-state-in-effect -- progress/ready drive the intro start
      setIntroStarted(true);
    }
  }, [introStarted, state.phase, percent, coreReady]);

  // Let the animation finish before the menu may appear.
  useEffect(() => {
    if (!introStarted || introDone) {
      return;
    }
    const id = setTimeout(() => setIntroDone(true), INTRO_DURATION_MS);

    return (): void => clearTimeout(id);
  }, [introStarted, introDone]);

  // Reveal the menu only when both the core load AND the intro animation are done.
  useEffect(() => {
    if (state.phase === 'core' && coreReady && introDone) {
      dispatch({ type: 'CORE_LOADED' });
    }
  }, [state.phase, coreReady, introDone]);

  // Rotate the preloader status text while loading.
  const loading = state.phase === 'core' || state.phase === 'textures';
  useEffect(() => {
    if (!loading) {
      return;
    }
    const id = setInterval(() => setTick((value) => value + 1), STATUS_INTERVAL_MS);

    return (): void => clearInterval(id);
  }, [loading]);

  const messages = state.phase === 'textures' ? TEXTURE_STATUS : CORE_STATUS;

  return {
    acceptDisclaimer: useCallback((): void => {
      rememberDisclaimerAccepted();
      dispatch({ type: 'DISCLAIMER_OK' });
    }, []),
    // Local loader, from the folder screen: prompt for the install folder (the picker must run in this
    // click — its user gesture). On success loading begins; a cancelled/denied prompt surfaces in `detail`.
    chooseFolder: useCallback((): void => {
      void (async (): Promise<void> => {
        try {
          await loader.prepare?.();
          setFolderReady(true);
          dispatch({ type: 'FOLDER_READY' });
        } catch (error) {
          if (!(error instanceof DOMException && error.name === 'AbortError')) {
            setDetail(String(error));
          }
        }
      })();
    }, [loader]),
    detail,
    fs: vfs,
    introStarted,
    pause: useCallback((): void => dispatch({ type: 'PAUSE' }), []),
    percent,
    // Fetch: straight into the loading/disclaimer flow. Local: go to the folder prompt, unless a remembered
    // folder was already restored (then jump straight to loading).
    play: useCallback((): void => {
      if (requiresGesture) {
        dispatch(folderReady ? { type: 'FOLDER_READY' } : { type: 'CHOOSE_FOLDER' });
      } else {
        dispatch({ type: 'PLAY' });
      }
    }, [requiresGesture, folderReady]),
    resume: useCallback((): void => dispatch({ type: 'RESUME' }), []),
    retry: useCallback((): void => {
      setDetail('');
      dispatch({ type: 'RETRY' });
    }, []),
    state,
    status: rotatingStatus(messages, tick),
    worldReady: useCallback((): void => dispatch({ type: 'WORLD_READY' }), []),
  };
}
