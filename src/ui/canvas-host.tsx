import { type ReactElement, useEffect, useRef, useState } from 'react';

import { Game } from '../game';
import { GtaSaWorldAdapter } from '../game/adapters/gta-sa-world.adapter';
import { loadPlayerMesh } from '../game/character/load-player';
import { setupCharacter } from '../game/character/setup-character';
import { AmbientLightPlugin } from '../game/plugins/ambient-light.plugin';
import { DirectionalLightPlugin } from '../game/plugins/directional-light.plugin';
import { CollisionStreamingSystem } from '../game/streaming/collision-streaming.system';
import { StreamingSystem } from '../game/streaming/streaming.system';
import { DebugOverlay } from './debug/debug-overlay';
import { GANTON_CJ_HOME, GANTON_RADIUS, PLAYER_SPAWN } from './locations';

const BASE = import.meta.env.VITE_STATIC_URL;

const CELL_SIZE = 250; // streaming grid cell edge — shared by Config.streaming + the adapter

// One bootstrap per page load, kept at module scope so React StrictMode's
// double-mount (dev) doesn't spin up a second renderer / archive download.
let bootstrapped: null | Promise<Game> = null;

/**
 * The single React surface: mounts the canvas the {@link Game} renders into and
 * the DOM debug overlay. React never touches the scene graph — it just wires the
 * canvas, forwards resize/pointer events, and shows load state.
 */
export function CanvasHost(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [phase, setPhase] = useState<'error' | 'loading' | 'ready'>('loading');
  const [errorText, setErrorText] = useState('');
  const debugEnabledRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let disposed = false;

    bootstrap(canvas)
      .then((ready) => {
        if (!disposed) {
          setGame(ready);
          setPhase('ready');
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setErrorText(String(error));
          setPhase('error');
        }
      });

    return (): void => {
      disposed = true;
    };
  }, []);

  // Keep the renderer/camera in sync with the canvas size, and only raycast on
  // click while the debug overlay is open (a full-map pick is not free).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !game) {
      return;
    }
    const observer = new ResizeObserver(() => game.resize(canvas.clientWidth, canvas.clientHeight));
    observer.observe(canvas);
    const off = game.events.on('debug-mode', ({ enabled }) => (debugEnabledRef.current = enabled));

    return (): void => {
      observer.disconnect();
      off();
    };
  }, [game]);

  function handleClick(event: React.MouseEvent<HTMLCanvasElement>): void {
    if (!game || !debugEnabledRef.current) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    game.pick(ndcX, ndcY);
  }

  return (
    <>
      <canvas onClick={handleClick} ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {phase === 'loading' && <Overlay text="Loading map…" />}
      {phase === 'error' && <Overlay text={`Failed to load map: ${errorText}`} />}
      {game && <DebugOverlay game={game} />}
    </>
  );
}

function bootstrap(canvas: HTMLCanvasElement): Promise<Game> {
  bootstrapped ??= (async (): Promise<Game> => {
    const game = Game.getInstance(canvas, {
      camera: { followDistance: 12, followMaxPolar: Math.PI / 2 - 0.05, followMinPolar: 0.25, followZoom: true },
      controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD' },
      debugMode: false,
      gameState: 'play',
      showCollision: false,
      staticUrl: BASE,
      streaming: { cellSize: CELL_SIZE, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1500 },
    });
    const adapter = new GtaSaWorldAdapter({
      archiveUrl: `${BASE}/models/gta3.img`,
      base: BASE,
      cellSize: CELL_SIZE,
      datUrl: `${BASE}/data/gta.dat`,
    });
    game.setWorldAdapter(adapter).addPlugin(new AmbientLightPlugin()).addPlugin(new DirectionalLightPlugin());

    await game.init();
    await game.loadGame(GANTON_CJ_HOME, { radius: GANTON_RADIUS });

    // Spawn the player (TEMP: a 3ds cube) on CJ's parking lot, then look at it.
    // ECS Transform drives its position via the render-sync system.
    const player = await loadPlayerMesh(`${BASE}/player/player.3ds`);
    player.scale.setScalar(0.8);
    const character = await setupCharacter(game, player, PLAYER_SPAWN);
    game.frameEntity(player, 12);

    // Stream map cells around the player (full models near, LODs ringing out).
    const streaming = new StreamingSystem(adapter, game.getStreamingRoot(), character.viewOf, game.getConfig());
    game.addSystem(streaming);
    game.setStreamingSystem(streaming);

    // Stream static collision (HD cells) around the player so it has ground everywhere.
    game.addSystem(new CollisionStreamingSystem(adapter, character.physics, character.viewOf, game.getConfig()));

    return game;
  })();

  return bootstrapped;
}

function Overlay({ text }: { text: string }): ReactElement {
  return (
    <div
      style={{
        alignItems: 'center',
        color: '#fff',
        display: 'flex',
        fontFamily: 'sans-serif',
        height: '100%',
        justifyContent: 'center',
        left: 0,
        position: 'fixed',
        top: 0,
        width: '100%',
      }}
    >
      {text}
    </div>
  );
}
