import { lazy, type ReactElement, Suspense, useEffect } from 'react';

import type { BootPhase } from './boot-machine';

import { initAnalytics } from './analytics';
import { PLAY_ENABLED } from './boot-machine';
import { Disclaimer } from './disclaimer';
import { ErrorPanel } from './error-panel';
import { GameHint } from './game-hint';
import { Logo } from './logo';
import { Menu } from './menu';
import { Preloader } from './preloader';
import { useAssetBoot } from './use-asset-boot';
import { useFullscreen } from './use-fullscreen';
import './shell.css';

// The heavy game surface (three.js/Rapier) is code-split — fetched only past the menu.
const GameCanvas = lazy(() => import('../canvas-host').then((module) => ({ default: module.CanvasHost })));

const DEGRADED_NOTE = 'Sorry, the game is unavailable right now — something went wrong. Please try again later.';
const MAINTENANCE_NOTE =
  'The playable demo is temporarily offline while we rework how the game is distributed. Code and updates are on GitHub.';
const SUBTITLED = 'sa-logo--small sa-logo--titled sa-logo--described';

export function App(): ReactElement {
  const boot = useAssetBoot();
  const fullscreen = useFullscreen();
  const { phase } = boot.state;
  const { pause, resume } = boot;

  // Count the visit (no-op unless VITE_GA_ID is set).
  useEffect(() => {
    initAnalytics();
  }, []);

  // Esc toggles pause ↔ play.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') {
        return;
      }
      if (phase === 'playing') {
        pause();
      } else if (phase === 'paused') {
        resume();
      }
    }
    window.addEventListener('keydown', onKeyDown);

    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [phase, pause, resume]);

  const showGame = phase === 'warmup' || phase === 'playing' || phase === 'paused';
  const showLoadingScreen = phase === 'core' || phase === 'textures' || phase === 'warmup';

  return (
    <div className="sa-shell">
      {showGame ? (
        <Suspense fallback={null}>
          <div className={phase === 'warmup' ? 'sa-game sa-hidden' : 'sa-game sa-fade-in'}>
            <GameCanvas fs={boot.fs} onWorldReady={boot.worldReady} paused={phase === 'paused'} />
          </div>
        </Suspense>
      ) : null}

      {showLoadingScreen ? (
        <div className="sa-stage">
          <Logo className={logoClass(phase, boot.introStarted)} />
        </div>
      ) : null}

      {phase === 'menu' ? (
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <p className="sa-tagline">Free and open source — a from-scratch re-creation of the RenderWare engine.</p>
          <Menu
            note={PLAY_ENABLED ? (boot.state.degraded ? DEGRADED_NOTE : undefined) : MAINTENANCE_NOTE}
            onPlay={boot.play}
            playDisabled={!PLAY_ENABLED || boot.state.degraded}
          />
        </div>
      ) : null}

      {phase === 'core' || phase === 'textures' ? <Preloader percent={boot.percent} status={boot.status} /> : null}
      {phase === 'disclaimer' ? <Disclaimer onAccept={boot.acceptDisclaimer} /> : null}
      {phase === 'error' ? <ErrorPanel detail={boot.detail} onRetry={boot.retry} /> : null}
      {phase === 'paused' ? (
        <div className="sa-overlay">
          <Menu onPlay={resume} playLabel="Continue" />
        </div>
      ) : null}

      {phase === 'playing' || phase === 'paused' ? <GameHint /> : null}

      {fullscreen.isFullscreen ? null : (
        <button className="sa-fullscreen-btn" onClick={fullscreen.toggle} type="button">
          ⛶ Fullscreen
        </button>
      )}
    </div>
  );
}

/** Logo state per phase: centered pulse while loading; the intro animates to small + subtitled. */
function logoClass(phase: BootPhase, introStarted: boolean): string {
  if (phase === 'textures' || phase === 'warmup') {
    return 'sa-logo--pulse'; // re-centered for the main (textures) load, no subtitles
  }
  if (phase === 'core') {
    return introStarted ? SUBTITLED : 'sa-logo--pulse'; // intro fires mid-load
  }

  return SUBTITLED; // menu / disclaimer / error / paused / playing
}
