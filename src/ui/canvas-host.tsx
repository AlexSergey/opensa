import { type ReactElement, useEffect, useRef, useState } from 'react';

import type { CharacterPlacement } from '../game/character/orient-character';
import type { Vec3 } from '../game/interfaces/world-adapter.interface';

import { Game } from '../game';
import { GtaSaWorldAdapter } from '../game/adapters/gta-sa-world.adapter';
import { AnimationController } from '../game/character/animation-controller';
import { CharacterAnimationSystem } from '../game/character/character-animation.system';
import { orientCharacter } from '../game/character/orient-character';
import { setupCharacter } from '../game/character/setup-character';
import { AmbientLightPlugin } from '../game/plugins/ambient-light.plugin';
import { DirectionalLightPlugin } from '../game/plugins/directional-light.plugin';
import { CollisionStreamingSystem } from '../game/streaming/collision-streaming.system';
import { StreamingSystem } from '../game/streaming/streaming.system';
import { EnterVehicleSystem } from '../game/vehicle/enter-vehicle.system';
import { VehicleDamageSystem } from '../game/vehicle/vehicle-damage.system';
import { VehiclePhysicsSystem } from '../game/vehicle/vehicle-physics.system';
import { DebugOverlay } from './debug/debug-overlay';
import { GANTON_CJ_HOME, GANTON_RADIUS, PLAYER_SPAWN } from './locations';

const BASE = import.meta.env.VITE_STATIC_URL;

const CELL_SIZE = 250; // streaming grid cell edge — shared by Config.streaming + the adapter

// Player collision box (half-extents) — a human, decoupled from the T-pose mesh bbox.
const PLAYER_HALF_EXTENTS: Vec3 = [0.3, 0.3, 0.9];
// The animation (idle/walk) stands the skeleton up in GTA Z-up, so the model needs
// NO rotation; offset nudges the feet onto the box base. (Tune offset/scale here.)
const TOMMY_PLACEMENT: CharacterPlacement = { offset: [0, 0, 0.04], rotation: [0, 0, 0], scale: 1 };

// Static cars parked on the Ganton lot near the spawn (native Z-up; heading about Z).
// admiral = 2-colour paint, camper = 4-colour. Positions/z/heading tuned in-browser.
const VEHICLE_PLACEMENTS: readonly { heading: number; model: string; position: Vec3 }[] = [
  { heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
  // Camper next to the admiral on the same flat strip (to compare start behaviour at a known-OK spot).
  { heading: 0, model: 'camper', position: [2496, -1678, 13.4] },
];

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
    // Single sink for gated diagnostics (silent unless `showLogs` is set). Already
    // level-filtered by the Logger; filter further by `type` here when debugging a
    // specific area, e.g. `if (type !== 'enter-vehicle') return;`.
    const offLog = game.events.on('log', ({ data, level, message, type }) => {
      // eslint-disable-next-line no-console -- this is the single intentional diagnostics sink
      console[level](`[${type}] ${message}`, data ?? '');
    });

    return (): void => {
      observer.disconnect();
      off();
      offLog();
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
      controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD', run: 'ShiftLeft' },
      debugMode: false,
      gameState: 'play',
      movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 3.5, runSpeed: 7, walkSpeed: 2 },
      showCollision: false,
      // Diagnostics off by default. Flip to 'debug' | 'log' | 'warn' | 'error' here to stream
      // gated `log` events to the console; filter by `type` in the subscriber below.
      showLogs: false,
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

    // Spawn the player (Tommy Vercetti DFF, a skinned mesh + skeleton) on CJ's
    // parking lot. The model is native GTA model-space (up = +Y); `orientCharacter`
    // stands it up in GTA Z-up under a wrapper the render-sync system positions.
    const model = await adapter.loadCharacter(`${BASE}/player/tommy.dff`, `${BASE}/player/tommy.txd`);
    const player = orientCharacter(model.object, TOMMY_PLACEMENT);
    const character = await setupCharacter(game, player, PLAYER_SPAWN, {
      bonesByName: model.bonesByName,
      halfExtents: PLAYER_HALF_EXTENTS,
      skeleton: model.skeleton,
    });
    game.frameEntity(player, 12);

    // Animations (ped.ifp from the packed WIMG archive) driven by the movement state machine.
    const clips = await adapter.loadAnimations(`${BASE}/anim/animations.img`, 'ped.ifp');
    const animation = new AnimationController(player, clips, character.bonesByName);
    animation.play('idle_stance', 0);
    const animationSystem = new CharacterAnimationSystem(animation, character.playerEid, player, game.getConfig());
    game.addSystem(animationSystem);

    // Stream map cells around the player (full models near, LODs ringing out).
    const streaming = new StreamingSystem(adapter, game.getStreamingRoot(), character.viewOf, game.getConfig());
    game.addSystem(streaming);
    game.setStreamingSystem(streaming);

    // Stream static collision (HD cells) around the player so it has ground everywhere.
    game.addSystem(new CollisionStreamingSystem(adapter, character.physics, character.viewOf, game.getConfig()));

    // Flat textured water surface (whole map; no shader). Parented to the −90°X streaming root.
    const water = await adapter.loadWater(`${BASE}/data/water.dat`, `${BASE}/models/particle.txd`);
    game.getStreamingRoot().add(water);

    // Painted cars parked near the spawn (native Z-up under the −90°X root). Each is a
    // dynamic physics body whose chassis collider is the convex hull of its embedded COL
    // (gravity rests it on its raycast wheels; the full COL is kept for later damage).
    const vehiclePhysics = new VehiclePhysicsSystem(character.physics);
    game.addSystem(vehiclePhysics);
    const vehicleDamage = new VehicleDamageSystem(character.physics, game.getLogger());
    game.addSystem(vehicleDamage);
    const enterVehicle = new EnterVehicleSystem(
      character.keyboard,
      character.viewOf,
      character.controllerSystem,
      character.placePlayer,
      animationSystem,
      (azimuth) => game.setFollowAzimuth(azimuth),
      (object) => game.setFollowTarget(object ?? player), // follow the car while seated, else the player
      game.getConfig(),
      character.physics,
      character.playerCollider,
      game.getLogger(),
    );
    game.addSystem(enterVehicle);
    for (const { heading, model, position } of VEHICLE_PLACEMENTS) {
      const { colliders, doors, halfExtents, handling, object, parts, rig, seats, wheels } =
        await adapter.loadVehicle(model);
      object.position.set(position[0], position[1], position[2]);
      object.rotation.z = heading;
      game.getStreamingRoot().add(object);
      // Driver seat = the front-seat dummy mirrored to the −X (driver) side.
      const seat = seats.frontseat;
      const seatLocal: [number, number, number] = seat
        ? [-Math.abs(seat.elements[12]), seat.elements[13], seat.elements[14]]
        : [-0.4, 0, 0];
      const { body, controller } = character.physics.createDynamicVehicle(
        position,
        heading,
        colliders?.shape ?? null,
        handling.mass,
        wheels,
      );
      // The physics system keeps these live from the body; seed with the placement.
      const live: [number, number, number] = [position[0], position[1], position[2]];
      const vehicle = {
        body,
        controller,
        doors,
        halfExtents,
        handling,
        heading,
        object,
        position: live,
        rig,
        seatLocal,
        wheels,
      };
      vehiclePhysics.add(vehicle);
      enterVehicle.add(vehicle);
      vehicleDamage.add({ body, object, parts });
    }

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
