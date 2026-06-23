import { lazy, type ReactElement, Suspense, useEffect } from 'react';

import type { BootPhase } from './boot-machine';

import { initAnalytics } from './analytics';
import { Disclaimer } from './disclaimer';
import { ErrorPanel } from './error-panel';
import { FolderPrompt } from './folder-prompt';
import { GameHint } from './game-hint';
import { Logo } from './logo';
import { Menu } from './menu';
import { Preloader } from './preloader';
import { useAssetBoot } from './use-asset-boot';
import { useFullscreen } from './use-fullscreen';
import './shell.css';

// The heavy game surface (three.js/Rapier) is code-split — fetched only past the menu.
const GameCanvas = lazy(() => import('../canvas-host').then((module) => ({ default: module.CanvasHost })));

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
  const showLoadingScreen = phase === 'loading' || phase === 'warmup';

  return (
    <div className="sa-shell">
      {showGame && boot.state.game ? (
        <Suspense fallback={null}>
          <div className={phase === 'warmup' ? 'sa-game sa-hidden' : 'sa-game sa-fade-in'}>
            <GameCanvas
              fs={boot.fs}
              gameId={boot.state.game}
              onWorldReady={boot.worldReady}
              paused={phase === 'paused'}
            />
          </div>
        </Suspense>
      ) : null}

      {showLoadingScreen ? (
        <div className="sa-stage">
          <Logo className={logoClass(phase)} />
        </div>
      ) : null}

      {phase === 'menu' ? (
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <p className="sa-tagline">Free and open source — a from-scratch re-creation of the RenderWare engine.</p>
          <Menu onPlay={boot.play} />
        </div>
      ) : null}

      {phase === 'folder' ? (
        <div className="sa-stage sa-stage--col">
          <Logo className={SUBTITLED} />
          <FolderPrompt
            detail={boot.detail}
            disclaimer={boot.disclaimerAccepted ? undefined : boot.disclaimer}
            onChoose={boot.chooseFolder}
          />
        </div>
      ) : null}

      {phase === 'loading' ? <Preloader percent={boot.percent} status={boot.status} /> : null}
      {phase === 'disclaimer' ? <Disclaimer onAccept={boot.acceptDisclaimer}>{boot.disclaimer}</Disclaimer> : null}
      {phase === 'error' ? <ErrorPanel detail={boot.detail} onRetry={boot.retry} /> : null}
      {phase === 'paused' ? (
        <div className="sa-overlay">
          <nav className="sa-menu">
            <button className="sa-menu__item" onClick={resume} type="button">
              Continue
            </button>
          </nav>
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

/** Logo state per phase: a centered pulse while loading, the small subtitled mark otherwise. */
function logoClass(phase: BootPhase): string {
  return phase === 'loading' || phase === 'warmup' ? 'sa-logo--pulse' : SUBTITLED;
}
