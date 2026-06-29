import type { CharacterPlacement } from '@opensa/game/character/orient-character';
import type { Vec3 } from '@opensa/game/interfaces/world-adapter.interface';
import type { SpawnedVehicle, VehiclePlacement } from '@opensa/game/vehicle/vehicle-lod.system';

import { Game } from '@opensa/game';
import { GtaSaWorldAdapter } from '@opensa/game/adapters/gta-sa-world.adapter';
import { AnimationController } from '@opensa/game/character/animation-controller';
import { CharacterAnimationSystem } from '@opensa/game/character/character-animation.system';
import { orientCharacter } from '@opensa/game/character/orient-character';
import { setupCharacter } from '@opensa/game/character/setup-character';
import { Velocity } from '@opensa/game/ecs/components';
import { TouchInputSource } from '@opensa/game/input';
import { createWindMod } from '@opensa/game/mods/wind.mod';
import { cloudProfile } from '@opensa/game/plugins/cloud-profile';
import { FogPlugin } from '@opensa/game/plugins/fog.plugin';
import { PostFxPlugin } from '@opensa/game/plugins/postfx.plugin';
import { SkyPlugin, type SkySample } from '@opensa/game/plugins/sky.plugin';
import { VehicleReflectionPlugin } from '@opensa/game/plugins/vehicle-reflection/vehicle-reflection.plugin';
import { WaterPlugin, type WaterSample } from '@opensa/game/plugins/water.plugin';
import { CollisionStreamingSystem } from '@opensa/game/streaming/collision-streaming.system';
import { StreamingSystem } from '@opensa/game/streaming/streaming.system';
import { clockNightFactor } from '@opensa/game/time/hour-window';
import { TimedObjectSystem } from '@opensa/game/time/timed-object.system';
import { EnterVehicleSystem } from '@opensa/game/vehicle/enter-vehicle.system';
import { VehicleDamageSystem } from '@opensa/game/vehicle/vehicle-damage.system';
import { VehicleHeadlightSystem } from '@opensa/game/vehicle/vehicle-headlight.system';
import { VehicleLodSystem } from '@opensa/game/vehicle/vehicle-lod.system';
import { VehiclePhysicsSystem } from '@opensa/game/vehicle/vehicle-physics.system';
import { weatherForCity } from '@opensa/game/weather/weather-zones';
import { cityAt, type CityBox, cityFromLevel, isDesertZone } from '@opensa/game/zones/city';
import { CityZoneSystem } from '@opensa/game/zones/city-zone.system';
import { type NamedZone, ZoneNameSystem } from '@opensa/game/zones/zone-name.system';
import {
  type AssetFileSystem,
  breakBreakable,
  buildTextureMap,
  coronaMaterial,
  dnBalanceUniform,
  getBreakableByKey,
  GLOW_LAYER,
  gxtKeyHash,
  type MapZone,
  nearestBreakable,
  nightFillRim,
  nightFillUniform,
  parseFxp,
  parseGxt,
  parseTxd,
  parseZones,
  particleTimeUniform,
  particleViewportUniform,
  sampleTimecycBlend,
  setFxLibrary,
  setRoadsignFont,
  updateAnimatedObjects,
  updateDebris,
  updateEscalators,
  updateParticleEffects,
  updateProcObjMeshes,
  updateUvAnimations,
  WEATHER_NAMES,
  windowGlowUniform,
  worldDayTintUniform,
  worldShadowUniforms,
  worldTintUniform,
} from '@opensa/renderware';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import {
  CameraHelper,
  Color,
  type Mesh,
  type Object3D,
  Quaternion,
  SRGBColorSpace,
  type Texture,
  Vector3,
} from 'three';

import type { DebugActions } from './debug/debug-overlay';

import { GAME_CONFIG, type GameId, HUMAN_HALF_EXTENTS } from '../game-config';
import { parseParkedVehicles } from '../parked-vehicles';
import { vehicleModelsFromIde } from '../vehicle-models';
import { isTouchDevice } from './controls/is-touch-device';
import { TouchControls } from './controls/touch-controls';
import { DebugOverlay } from './debug/debug-overlay';
import { Hud } from './hud/hud';
import { loadFonts } from './hud/load-fonts';
import { Overlay } from './hud/overlay';

const BASE = import.meta.env.VITE_STATIC_URL;

const CELL_SIZE = 250; // streaming grid cell edge — shared by Config.streaming + the adapter
const WORLD_READY_TIMEOUT_MS = 12000; // reveal the game even if grounding is delayed
const FLY_GROUND_MAX_DROP = 2000; // max downward ray (m) to find the ground when leaving fly mode
const GROUND_SNAP_LIFT = 1.5; // start the map-car ground ray this far above the generator (clears a floor it sits in)
const GROUND_SNAP_DROP = 5; // max downward distance (m) to find the ground beneath a map-car generator

// The animation (idle/walk) stands the skeleton up in GTA Z-up, so the model needs
// NO rotation; offset nudges the feet onto the box base. (Tune offset/scale here.)
const PLAYER_PLACEMENT: CharacterPlacement = { offset: [0, 0, 0.04], rotation: [0, 0, 0], scale: 1 };

// Selectable weathers for the debug Weather tab — all timecyc weathers except rain/storm/underwater
// and the cutscene EXTRACOLOURS entries (per the "sunny/cloudy/etc, no rain/storm" ask).
const WEATHERS: readonly { index: number; label: string }[] = WEATHER_NAMES.map((label, index) => ({
  index,
  label,
})).filter(({ label }) => !/RAINY|SANDSTORM|UNDERWATER|EXTRACOLOUR/.test(label));

interface Bootstrap {
  /** Whether enter/exit-vehicle is actionable now — gates the mobile Enter button's visibility. */
  canEnterExit: () => boolean;
  debugActions: DebugActions;
  game: Game;
  /** On-screen touch input source (present only on touch devices); drives `<TouchControls>`. */
  touchInput: null | TouchInputSource;
}

/** Read map.zon and map its boxes to city AABBs ([] when absent → everything classifies as Countryside). */
function loadCityBoxes(fs: AssetFileSystem, name: string): CityBox[] {
  const text = fs.getText(name);
  if (text === null) {
    return [];
  }

  return parseZones(text).flatMap((zone) => {
    const city = cityFromLevel(zone.level);

    return city ? [{ city, max: zone.max, min: zone.min }] : [];
  });
}

/** Parse a `.gxt` text archive into a `hash → text` map (null when absent). */
function loadGxt(fs: AssetFileSystem, name: string): Map<number, string> | null {
  const buffer = fs.get(name);

  return buffer ? parseGxt(buffer) : null;
}

/** Read info.zon's zones ([] when absent). Drives both the desert boxes (by name) and the zone-name HUD. */
function loadInfoZones(fs: AssetFileSystem, name: string): MapZone[] {
  const text = fs.getText(name);

  return text === null ? [] : parseZones(text);
}

/** Parse a standalone .txd into a name→Texture map (null when absent). */
function loadTxd(fs: AssetFileSystem, name: string): Map<string, Texture> | null {
  const buffer = fs.get(name);

  return buffer ? buildTextureMap(parseTxd(buffer)) : null;
}

// One bootstrap per page load, kept at module scope so React StrictMode's
// double-mount (dev) doesn't spin up a second renderer / archive download.
let bootstrapped: null | Promise<Bootstrap> = null;

/**
 * The single React surface: mounts the canvas the {@link Game} renders into and
 * the DOM debug overlay. React never touches the scene graph — it just wires the
 * canvas, forwards resize/pointer events, and shows load state.
 */
interface CanvasHostProps {
  fs: AssetFileSystem;
  /** The selected game id — selects its `GAME_CONFIG` entry (spawn, vehicles, teleports, …). */
  gameId: GameId;
  /** Called once the world has settled (player grounded) — the shell reveals the game on this. */
  onWorldReady?: () => void;
  /** Freeze the game (physics + control + clock) while the pause menu is up. */
  paused?: boolean;
}

export function CanvasHost({ fs, gameId, onWorldReady, paused = false }: CanvasHostProps): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [actions, setActions] = useState<DebugActions | null>(null);
  const [touchInput, setTouchInput] = useState<null | TouchInputSource>(null);
  const [canEnterExit, setCanEnterExit] = useState<(() => boolean) | null>(null);
  const [phase, setPhase] = useState<'error' | 'loading' | 'ready'>('loading');
  const [errorText, setErrorText] = useState('');
  const [locked, setLocked] = useState(false);
  const debugEnabledRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let disposed = false;

    bootstrap(canvas, fs, gameId, onWorldReady)
      .then((ready) => {
        if (!disposed) {
          setGame(ready.game);
          setActions(ready.debugActions);
          setTouchInput(ready.touchInput);
          setCanEnterExit(() => ready.canEnterExit);
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
  }, [fs, gameId, onWorldReady]);

  // Pause/resume the game (frozen physics + control + clock) when the shell shows the pause menu.
  useEffect(() => {
    game?.setGameState(paused ? 'pause' : 'play');
    if (paused && document.pointerLockElement) {
      document.exitPointerLock(); // free the cursor for the pause menu
    }
  }, [game, paused]);

  // Track mouse capture (pointer lock) — the look uses movementX/Y, continuous + cursor-hidden while locked.
  useEffect(() => {
    const onChange = (): void => setLocked(document.pointerLockElement === canvasRef.current);
    document.addEventListener('pointerlockchange', onChange);

    return (): void => document.removeEventListener('pointerlockchange', onChange);
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
    const off = game.events.on('map-viewer', ({ enabled }) => (debugEnabledRef.current = enabled));
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

  // Screenshot camera: K+M toggles free-fly (detached camera, arrows + mouse). Opening the
  // debugger (F2) drops it. Camera-only — nothing else in the game is affected.
  useEffect(() => {
    if (!game) {
      return;
    }
    let kDown = false;
    let mDown = false;
    let fly = false;
    let chordFired = false;
    const setFly = (on: boolean): void => {
      fly = on;
      game.setFlyCamera(on);
    };
    function onKeyDown(e: KeyboardEvent): void {
      kDown ||= e.code === 'KeyK';
      mDown ||= e.code === 'KeyM';
      if (kDown && mDown && !chordFired) {
        chordFired = true;
        setFly(!fly);
      }
      if (e.key === 'F2') {
        if (fly) {
          setFly(false); // entering the debugger leaves fly mode
        }
        if (document.pointerLockElement) {
          document.exitPointerLock(); // free the cursor for the debug panel
        }
      }
    }
    function onKeyUp(e: KeyboardEvent): void {
      if (e.code === 'KeyK' || e.code === 'KeyM') {
        kDown = kDown && e.code !== 'KeyK';
        mDown = mDown && e.code !== 'KeyM';
        chordFired = false;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return (): void => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
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

  function capture(): void {
    // Newer browsers return a Promise that can reject (denied / unsupported); swallow it either way.
    void Promise.resolve(canvasRef.current?.requestPointerLock()).catch(() => undefined);
  }

  return (
    <>
      <canvas onClick={handleClick} ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {game && !locked && !paused && !touchInput ? (
        <button className="sa-capture" onClick={capture} type="button">
          Click to play
        </button>
      ) : null}
      {game && touchInput && !paused && <TouchControls canEnterExit={canEnterExit ?? undefined} source={touchInput} />}
      {phase === 'loading' && <LoadOverlay text="Loading map…" />}
      {phase === 'error' && <LoadOverlay text={`Failed to load map: ${errorText}`} />}
      {game && (
        <Overlay>
          <Hud game={game} />
        </Overlay>
      )}
      {game && actions && (
        <DebugOverlay actions={actions} game={game} teleports={GAME_CONFIG[gameId].teleports ?? []} />
      )}
    </>
  );
}

export function LoadOverlay({ text }: { text: string }): ReactElement {
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

function bootstrap(
  canvas: HTMLCanvasElement,
  fs: AssetFileSystem,
  gameId: GameId,
  onWorldReady?: () => void,
): Promise<Bootstrap> {
  bootstrapped ??= (async (): Promise<Bootstrap> => {
    const config = GAME_CONFIG[gameId];
    const game = Game.getInstance(canvas, {
      camera: {
        followDistance: 7,
        followHeight: 1.2,
        followLerp: 3,
        followMaxPolar: Math.PI / 2 - 0.05,
        followMinPolar: 0.25,
        followPolar: 1.15,
        followZoom: true,
        followZoomMax: 10,
        followZoomMin: 4,
      },
      controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD', run: 'ShiftLeft' },
      fog: { distance: 800 },
      fonts: { hud: { clock: 'SixCaps-Regular', zone: 'SixCaps-Regular' } },
      gameState: 'play',
      graphics: {
        bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
        clouds: { coverage: 0.5, opacity: 0.85 },
        // World 2dfx particle effects (plan 044) — drawDistance replaces the systems' authored
        // CULLDIST (vanilla culls fire at 35 m — too close).
        effects: { drawDistance: 150, enabled: true },
        headlights: { coronaIntensity: 0.8, coronaSize: 0.28, intensity: 1 },
        lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
        moon: { brightness: 1, elevationDeg: 5, size: 55 },
        night: {
          coronaDrawDistance: 120,
          dynamicObjectsFill: { rim: 0.1, strength: 0.8 }, // plan 034: dynamic-object night fill
          litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 20, duskStart: 19 },
          skylight: 0.6,
          windowGlow: 1.0,
        },
        // Procedural ground clutter (procobj.dat; plan 042) — per-category, live-tunable in debug → ProcObj.
        procobj: {
          bushes: { density: 1, drawDistance: 80, enabled: true },
          cacti: { density: 1, drawDistance: 100, enabled: true },
          flowers: { density: 1, drawDistance: 50, enabled: true },
          grass: { density: 1, drawDistance: 50, enabled: true },
          rocks: { density: 1, drawDistance: 80, enabled: true },
          trees: { density: 1, drawDistance: 150, enabled: true },
          underwater: { density: 1, drawDistance: 60, enabled: true },
        },
        shadows: { enabled: true },
        sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
        ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
        stars: { enabled: true },
        sun: { godrays: true, godraysSize: 30, sunSize: 15 },
        toneMapping: true,
        vehicleReflection: { intensity: 0.25, preset: 'enhanced' },
        water: { darkness: 0.9, glint: 0.5, reflection: 0.2 },
        // SA prelit world (plan 038) calibration — live-tunable in debug → Atmosphere.
        worldLight: {
          dayBrightness: 0.85,
          duskBrightness: 0.45,
          lodNightAmbScale: 1.6,
          nightPrelitBrightness: 0.7,
          shadowStrength: 0.55,
        },
      },
      hud: {
        clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 },
        zone: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 40 },
      },
      mapViewer: false,
      movement: { accel: 20, airControl: 0.3, deceleration: 25, jumpSpeed: 3.5, runSpeed: 7, walkSpeed: 2 },
      showCollision: false,
      // Diagnostics off by default. Flip to 'debug' | 'log' | 'warn' | 'error' here to stream
      // gated `log` events to the console; filter by `type` in the subscriber below.
      showLogs: false,
      staticUrl: BASE,
      // lodDrawDistance kept just past fog.distance (800): geometry is culled shortly after it's fully
      // fogged, so the distant skyline isn't rendered as pale ghosts (and it's cheaper).
      streaming: { cellSize: CELL_SIZE, collisionDrawDistance: 150, hdDrawDistance: 300, lodDrawDistance: 1000 },
      time: { secondsPerGameMinute: 1.5 },
      vehicle: { hdDistance: 80, lodDistance: 250, unloadDistance: 500 },
      weatherTransitionSeconds: 6,
    });
    // Game mods (plan 039): installMod wires their per-frame update; the adapter runs their
    // decoratePart build hooks (one mod object, both registrations).
    const windMod = createWindMod();
    game.installMod(windMod);
    const adapter = new GtaSaWorldAdapter({
      cellSize: CELL_SIZE,
      // Script-gated placement groups (plan 042) — our permanent "world state". Available:
      // truthsfarm (Truth's weed farm), barriers1/2 (SF+LV unlock roadblocks — left off: the map
      // is fully open here), carter/crack (mission-state crack-palace pieces — left off).
      extraIpl: ['truthsfarm'],
      fs,
      mods: [windMod],
      // Clutter collision follows the live per-category knobs (0 when disabled) — see setProcObj.
      procObjDensityOf: (category): number => {
        const setting = game.getConfig().graphics.procobj[category];

        return setting.enabled ? setting.density : 0;
      },
      // Clutter cap per cell: over the limit, the highest-lottery placements are not rendered
      // and therefore not collided either — one budget drives both (vanilla pools at ~300 for
      // the same perf reason: physics bodies are the expensive part).
      procObjLimit: 150,
    });

    // Timecyc (sky/sun/light table by time of day) — loaded before the scene so the sky plugin has it.
    // Phase 1: a gradient sky dome from the EXTRASUNNY_LA skyTop/skyBot colours; sun/fog come next.
    const timecyc = await adapter.loadTimecyc();
    const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
    const skySample = (hour: number): SkySample => {
      const { from, t, to } = game.getWeatherBlend();
      const e = sampleTimecycBlend(timecyc, from, to, hour, t);
      const a = cloudProfile(WEATHER_NAMES[from] ?? '');
      const b = cloudProfile(WEATHER_NAMES[to] ?? '');

      return {
        amb: e.amb,
        ambObj: e.ambObj,
        cloudBottom: e.bottomClouds,
        cloudCover: lerp(a.coverage, b.coverage, t),
        cloudDark: lerp(a.darkness, b.darkness, t),
        cloudTop: e.lowClouds,
        dir: e.dir,
        skyBot: e.skyBot,
        skyTop: e.skyTop,
        spriteBright: e.spriteBright,
        spriteSize: e.spriteSize,
        sunCore: e.sunCore,
        sunCorona: e.sunCorona,
        sunSize: e.sunSize,
      };
    };
    const waterSample = (hour: number): WaterSample => {
      const { from, t, to } = game.getWeatherBlend();
      const e = sampleTimecycBlend(timecyc, from, to, hour, t);

      return {
        horizon: e.skyBot,
        sun: e.sunCore,
        water: [e.water[0], e.water[1], e.water[2]],
        waterAlpha: e.water[3] / 255,
      };
    };
    // The moon uses the SA `coronamoon` texture from particle.txd (alpha-shaped); null if it can't be loaded.
    const particleTextures = loadTxd(fs, 'models/particle.txd');
    const moonTexture = particleTextures?.get('coronamoon') ?? null;
    // Road-sign text (plan 042 item 5): the glyph atlas the sign quads UV into. Installed before
    // any cell builds, so every streamed sign model gets its text parts.
    setRoadsignFont(particleTextures?.get('roadsignfont') ?? null);
    // 2dfx particle effects (plan 044): the FX library — systems from effects.fxp + sprites from
    // effectsPC.txd. Both absent-tolerant: no files, no particles.
    const fxpText = fs.getText('models/effects.fxp');
    const fxSprites = loadTxd(fs, 'models/effectsPC.txd');
    if (fxpText && fxSprites) {
      setFxLibrary(parseFxp(fxpText), fxSprites);
    }
    const sky = new SkyPlugin(skySample, () => game.getHours(), moonTexture); // sky dome + sun/moon + lights
    const reflection = new VehicleReflectionPlugin(() => game.getHours()); // sky-probe reflections on spawned cars

    // Water mesh (geometry from the adapter) loaded up front so the WaterPlugin can own its material;
    // parented under the −90°X streaming root (which `game.init` adds to the scene).
    const water = await adapter.loadWater('data/water.dat', 'models/particle.txd');
    game.getStreamingRoot().add(water);

    game
      .setWorldAdapter(adapter)
      .addPlugin(new FogPlugin(() => skySample(game.getHours()).skyBot)) // fog fades into the sky horizon
      .addPlugin(sky)
      .addPlugin(
        new WaterPlugin(
          water as Mesh,
          waterSample,
          () => game.getHours(),
          () => sky.getSunDirection(),
        ),
      )
      .addPlugin(reflection) // vehicle env-map reflections (preset-driven)
      // Post-FX host: god rays + bloom + tone mapping + SSAO (GLOW_LAYER is hidden from its normal prepass).
      .addPlugin(new PostFxPlugin(sky.godraysSource, GLOW_LAYER));

    await loadFonts(game.getConfig().fonts); // register HUD fonts before the scene/HUD render
    await game.init();
    // Corona Points live on GLOW_LAYER (excluded from the SSAO normal prepass) — the camera must see it.
    game.getCamera().layers.enable(GLOW_LAYER);
    // Single source of truth for where the player starts: the game's spawn seeds the initial collision zone
    // (so there's ground under the drop) AND the player capsule. Clock/weather are load/session params.
    const spawn = config.playerSpawn;
    await game.loadGame(spawn, {
      radius: config.loadGame.radius,
      startMinutes: config.loadGame.startMinutes,
      weather: WEATHER_NAMES.indexOf(config.loadGame.weather),
    });

    // The model is native GTA model-space (up = +Y); `orientCharacter` stands it up in GTA Z-up under a
    // wrapper the render-sync system positions. `mainCharacter` picks the player ped from peds.ide.
    const model = await adapter.loadCharacterByModel(config.mainCharacter);
    const player = orientCharacter(model.object, PLAYER_PLACEMENT);
    const character = await setupCharacter(game, player, spawn, {
      bonesByName: model.bonesByName,
      halfExtents: config.playerHalfExtents ?? HUMAN_HALF_EXTENTS,
      skeleton: model.skeleton,
    });
    game.frameEntity(player, 12);

    // World-ready: signal once the player has landed (collision cell loaded → grounded), so the shell
    // reveals the game only after the world has settled (a fallback timer guards a delayed grounding).
    if (onWorldReady) {
      let fired = false;
      const fire = (): void => {
        if (!fired) {
          fired = true;
          onWorldReady();
        }
      };
      game.addSystem({
        name: 'world-ready',
        update: (): void => {
          if (Velocity.grounded[character.playerEid] === 1) {
            fire();
          }
        },
      });
      setTimeout(fire, WORLD_READY_TIMEOUT_MS);
    }

    // Animations: ped.ifp loaded directly (like the original), driven by the movement state machine.
    const clips = await adapter.loadAnimations('anim/ped.ifp');
    // Pass the skeleton's real root bone so the IFP root track retargets even on models that renamed it.
    const animation = new AnimationController(player, clips, character.bonesByName, character.skeleton?.bones[0]?.name);
    animation.play('idle_stance', 0);
    const animationSystem = new CharacterAnimationSystem(animation, character.playerEid, player, game.getConfig());
    game.addSystem(animationSystem);

    // Stream map cells around the player (full models near, LODs ringing out).
    const streaming = new StreamingSystem(adapter, game.getStreamingRoot(), character.viewOf, game.getConfig());
    game.addSystem(streaming);
    game.setStreamingSystem(streaming);

    // Track which city the player is in (map.zon boxes) → `game.setCity` emits `'city'` on change (HUD/debug;
    // later: cross-fade the weather for that city). Plan 035.
    // Zones: city/desert (weather) from map.zon + info.zon counties; district name (HUD) from all info.zon zones
    // resolved through the GXT. info.zon + the GXT are fetched once and shared.
    const cityBoxes = loadCityBoxes(fs, 'data/map.zon');
    const infoZones = loadInfoZones(fs, 'data/info.zon');
    const gxt = loadGxt(fs, 'text/american.gxt');

    // On a region crossing: update the city state, and follow the weather for that region while KEEPING the
    // current type (cross-fades over weatherTransitionSeconds). Desert boxes go FIRST so they win over the
    // coarse Las Venturas city box where it overruns Bone County.
    const desertBoxes: CityBox[] = infoZones.flatMap((zone) =>
      isDesertZone(zone.name) ? [{ city: 'DESERT' as const, max: zone.max, min: zone.min }] : [],
    );
    const orderedCityBoxes = [...desertBoxes, ...cityBoxes]; // desert first (wins over the coarse LV box)
    game.addSystem(
      new CityZoneSystem(orderedCityBoxes, character.viewOf, (city) => {
        game.setCity(city);
        game.setWeather(weatherForCity(WEATHER_NAMES, game.getWeather(), city));
      }),
    );

    // District name HUD: the smallest containing info.zon zone → its GXT text (the zone's text LABEL is the GXT
    // key; numbered districts like OCEAF1/2/3 share label OCEAF). Blank/whitespace names = no label → hidden.
    const namedZones: NamedZone[] = infoZones.map((zone) => ({ max: zone.max, min: zone.min, name: zone.label }));
    game.addSystem(
      new ZoneNameSystem(namedZones, character.viewOf, (key) => game.setZone((gxt?.get(gxtKeyHash(key)) ?? '').trim())),
    );

    // Show/hide time-of-day (tobj) objects (lit-window night variants, etc.) by the game hour.
    game.addSystem(new TimedObjectSystem(game.getStreamingRoot(), () => game.getHours()));

    // Night lights ride two signals: the **coronas** cross-fade by the smooth sun-height night factor
    // (`sky.godraysSource.userData.night`) so they fade with the ambient at dusk/dawn; the baked **night vertex
    // colours** (and the ACES night tonemap, in PostFxPlugin) instead ride a fixed wall-CLOCK schedule —
    // `clockNightFactor(hour, night.litFade)` — so lit windows switch on at set hours (tunable in debug →
    // Atmosphere). Neither uses the hard 20→6 lamp hour-window, which snapped lamps off out of sync.
    // SA prelit world (plan 038): the brightness scalars live in `graphics.worldLight` (debug →
    // Atmosphere); only the fixed hues stay here. Day arc follows the SUN HEIGHT (peak at noon →
    // warm dim near the horizon), like SA's per-hour timecyc table — otherwise dawn snaps to full
    // brightness on the clock fade and the sunrise/sun disc/god-rays all read wrong.
    const WORLD_DAWN_HUE = new Color(1, 0.89, 0.84); // warm horizon dim (× duskBrightness)
    const WORLD_NIGHT_PRELIT_HUE = new Color(1, 1, 1.03); // faint cool cast on the night prelit
    const worldTintNight = new Color();
    const worldTintDayPeak = new Color();
    const worldTintDawn = new Color();
    const worldTintNightPrelit = new Color();
    const worldTintDayArc = new Color();
    // Timed window overlays: authored additive glow base, scaled live by the `night.windowGlow` knob.
    const WINDOW_GLOW_BASE = 1.2;
    // `?nocull=1` (debug): disable frustum culling on every streamed mesh each frame — if a
    // "missing" model appears, its bounding sphere (not the geometry) is the bug.
    const noCull = new URLSearchParams(window.location.search).get('nocull') === '1';
    // `?shadowdebug=1`: paint the world-shadow term red + draw the sun shadow camera frustum, to
    // separate it from SSAO / baked prelit darkening while calibrating plan 038.
    const shadowDebug = new URLSearchParams(window.location.search).get('shadowdebug') === '1';
    worldShadowUniforms.uWorldShadowDebug.value = shadowDebug ? 1 : 0;
    const shadowHelper = shadowDebug ? new CameraHelper(sky.getSunShadow().camera) : null;
    if (shadowHelper) {
      game.getScene().add(shadowHelper);
    }

    // Animated map objects (plan 041): UV-animated textures (signs/waterfalls scroll their map
    // UVs via shared dict uniforms — every instance in sync, like vanilla) + IFP-animated clumps
    // (oil pumps, windmills — per-object mixers; streamed-out objects pause automatically).
    game.addSystem({
      name: 'map-animations',
      update(delta: number): void {
        updateUvAnimations(performance.now() / 1000);
        updateAnimatedObjects(delta);
        // 2dfx particle emitters (plan 044): lifecycle lives in the vertex shader off this clock.
        particleTimeUniform.value = performance.now() / 1000;
        // 2dfx escalators (plan 044): step rows loop along their baked paths off the same clock.
        updateEscalators(performance.now() / 1000);
      },
    });

    // Procedural clutter gating (plan 042): apply the live per-category config — enabled /
    // drawDistance (view distance in Z-up world space) / density (lottery count cutoff).
    game.addSystem({
      name: 'procobj',
      update(): void {
        updateProcObjMeshes(character.viewOf(), game.getConfig().graphics.procobj);
      },
    });

    // World 2dfx particle effects gating (plan 044): enabled toggle + draw distance (replaces
    // the systems' authored CULLDIST; the shader fade uses the same distance — no popping).
    game.addSystem({
      name: 'effects',
      update(): void {
        updateParticleEffects(character.viewOf(), game.getConfig().graphics.effects);
      },
    });

    game.addSystem({
      name: 'coronas',
      update(): void {
        const { lights, night, worldLight } = game.getConfig().graphics;
        const nightFactor = (sky.godraysSource.userData.night as number | undefined) ?? 0;
        coronaMaterial.uniforms.uOn.value = lights.enabled ? nightFactor : 0;
        coronaMaterial.uniforms.uViewportHeight.value = canvas.height || canvas.clientHeight;
        particleViewportUniform.value = canvas.height || canvas.clientHeight;
        coronaMaterial.uniforms.uDrawDistance.value = night.coronaDrawDistance;
        // Timed window overlays glow additively over the world material's night blend; the existing
        // `night.windowGlow` debug knob keeps scaling them (1.0 = the authored 1.2 base inside the uniform).
        windowGlowUniform.value = WINDOW_GLOW_BASE * night.windowGlow;
        // Dynamic objects (player/vehicles) self-illuminate at night via a shader fill (plan 034), faded by the
        // sun-height factor (how dark it actually is) × the configurable strength.
        nightFillUniform.value = nightFactor * night.dynamicObjectsFill.strength;
        nightFillRim.value = night.dynamicObjectsFill.rim;
        // SA prelit world (plan 038): the day↔night prelit blend rides the same wall-clock fade as the lit
        // windows; the global tint dims models without night prelit toward the weather's timecyc ambient.
        // Driven unconditionally — the uniforms are inert in 'dynamic' mode (no world materials exist).
        dnBalanceUniform.value = clockNightFactor(game.getHours(), night.litFade);
        const amb = skySample(game.getHours()).amb;
        worldTintNight
          .setRGB(amb[0] / 255, amb[1] / 255, amb[2] / 255, SRGBColorSpace)
          .multiplyScalar(worldLight.lodNightAmbScale);
        worldTintDayPeak.setScalar(worldLight.dayBrightness);
        worldTintDawn.copy(WORLD_DAWN_HUE).multiplyScalar(worldLight.duskBrightness);
        worldTintNightPrelit.copy(WORLD_NIGHT_PRELIT_HUE).multiplyScalar(worldLight.nightPrelitBrightness);
        // Day arc by sun height (nightFactor ramps as the sun nears the horizon) — smooth sunrise/sunset.
        worldTintDayArc.copy(worldTintDayPeak).lerp(worldTintDawn, nightFactor);
        // No-night models (LODs): day arc → dark night ambient; night-prelit models: day arc → the
        // night-prelit level (their own night set carries the picture; this only scales its brightness).
        worldTintUniform.value.copy(worldTintDayArc).lerp(worldTintNight, dnBalanceUniform.value);
        worldDayTintUniform.value.copy(worldTintDayArc).lerp(worldTintNightPrelit, dnBalanceUniform.value);
        // Manual shadow-receive on the unlit world (plan 038 iter 3): mirror the sun's shadow map +
        // matrix into the world material, with strength = config × day factor × overcast fade.
        // `autoUpdate` gate: while the sun isn't actually casting (night / below horizon / heavy
        // overcast) the SkyPlugin freezes the shadow render — sampling that STALE map pointed dawn
        // shadows the wrong way (yesterday's sunset direction), so the term must be fully off.
        const sunShadow = sky.getSunShadow();
        const { shadows } = game.getConfig().graphics;
        worldShadowUniforms.uWorldShadowMap.value = sunShadow.map?.texture ?? null;
        worldShadowUniforms.uWorldShadowMatrix.value = sunShadow.matrix;
        worldShadowUniforms.uWorldShadowMapSize.value.copy(sunShadow.mapSize);
        // (1 − nightFactor)² — squared so low-sun (dawn/dusk) shadows dissolve fast: at horizon sun the
        // geometric shadow length explodes (1/tan elevation), and a 30 m faint streak reads as a glitch.
        const sunUp = (1 - nightFactor) * (1 - nightFactor);
        worldShadowUniforms.uWorldShadowStrength.value =
          shadows.enabled && sunShadow.autoUpdate && worldShadowUniforms.uWorldShadowMap.value
            ? worldLight.shadowStrength * sunUp * sunShadow.intensity
            : 0;
        shadowHelper?.update(); // debug frustum follows the view-snapped shadow camera
        if (noCull) {
          // Diagnostic only: brute-force per frame so freshly streamed cells are covered too.
          game.getStreamingRoot().traverse((object) => {
            object.frustumCulled = false;
          });
        }
      },
    });

    // Stream static collision (HD cells) around the player so it has ground everywhere.
    const collisionStreaming = new CollisionStreamingSystem(
      adapter,
      character.physics,
      character.viewOf,
      game.getConfig(),
    );
    game.addSystem(collisionStreaming);
    // Clutter knob changes re-stream physics so collision matches the rendered set; debounced —
    // a slider drag fires many config patches, and a full collider rebuild per tick would stutter.
    let colliderReloadTimer: number | undefined;
    const reloadClutterColliders = (): void => {
      window.clearTimeout(colliderReloadTimer);
      colliderReloadTimer = window.setTimeout(() => {
        adapter.invalidateColliderCache();
        collisionStreaming.reload();
      }, 300);
    };

    // Painted cars parked near the spawn (native Z-up under the −90°X root). Each is a
    // dynamic physics body whose chassis collider is the convex hull of its embedded COL
    // (gravity rests it on its raycast wheels; the full COL is kept for later damage).
    const vehiclePhysics = new VehiclePhysicsSystem(character.physics);
    game.addSystem(vehiclePhysics);
    const vehicleDamage = new VehicleDamageSystem(character.physics, game.getLogger());
    game.addSystem(vehicleDamage);
    const enterVehicle = new EnterVehicleSystem(
      character.input,
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
    // Night headlights on the occupied car: glowing lamp glass + small coronas at the lamp dummies + two
    // forward-down spotlights (light dynamic objects ahead; the unlit road stays dark). Gated on seated+night.
    game.addSystem(
      new VehicleHeadlightSystem(
        enterVehicle,
        () => game.isNight(),
        game.getStreamingRoot(),
        () => game.getConfig().graphics.headlights,
        GLOW_LAYER,
        game.getCamera(),
      ),
    );

    // Breakable props (plan 045): debris lifecycle clock + the smash triggers. Smashing collapses
    // the prop's InstancedMesh slots, flies its shatter mesh as debris, and drops its static body so
    // the car drives through (the cell rebuild respawns it). Shared by the impact + debugger triggers.
    const streamingRoot = game.getStreamingRoot();
    const breakProp = (entry: ReturnType<typeof nearestBreakable>, impact?: Vec3): void => {
      if (entry && breakBreakable(entry, streamingRoot, { impact })) {
        collisionStreaming.removeBreakable(entry.key);
      }
    };
    // Vehicle impact uses the REAL collision (like SA's CObject::ObjectDamage): the chassis collider
    // follows the COL contour and Rapier emits contact-force events for it, so we break the prop a
    // car actually touches — at the real contact point, with the real impact force. Each event whose
    // static body is a registered breakable prop breaks it when the force clears the threshold.
    // object.dat tunes the per-prop threshold (higher damage multiplier → breaks easier) and marks
    // huge-mass props indestructible. (Contact-force events fire only for chassis colliders, so the
    // on-foot player can't smash props — matching vanilla.)
    const BREAK_FORCE = 3000; // base contact force (N) to smash a prop — calibrate via `showLogs:'debug'`
    // Truly indestructible cutscene/fixed props are mass 99999; breakable fences sit at 50000 (uproot
    // tuning, not "indestructible"), so the cutoff must clear 50000.
    const INDESTRUCTIBLE_MASS = 90000;
    const logger = game.getLogger();
    game.addSystem({
      name: 'breakables',
      update(): void {
        updateDebris(performance.now() / 1000);
        for (const impact of character.physics.takeBreakableImpacts()) {
          const keyA = collisionStreaming.breakableKeyOf(impact.bodyA);
          const key = keyA ?? collisionStreaming.breakableKeyOf(impact.bodyB);
          if (key === undefined) {
            continue; // contact didn't involve a breakable prop
          }
          const entry = getBreakableByKey(key);
          if (!entry) {
            continue;
          }
          logger.debug('breakable', `hit ${entry.modelName} force=${impact.force.toFixed(0)}`, impact);
          const info = adapter.breakableInfo(entry.modelName);
          if (info && info.mass >= INDESTRUCTIBLE_MASS) {
            continue; // tuned indestructible (cutscene/fixed prop)
          }
          if (impact.force < BREAK_FORCE / Math.min(3, Math.max(0.5, info?.colDamageMultiplier ?? 1))) {
            continue;
          }
          // Fling the shards along the hitter's (the car's) velocity — the non-breakable body.
          const hitter = keyA ? impact.bodyB : impact.bodyA;
          breakProp(entry, hitter === null ? undefined : character.physics.getLinvel(hitter));
        }
      },
    });

    // Spawn one car: load it, place it, make it a dynamic body, and register it with the vehicle
    // systems. With `anchor`, the position is computed just in front of it (clear of its body, sized
    // from the car's COL bounds). Returns how to despawn it (used by the LOD system / debug menu).
    const spawnVehicle = async (
      placement: VehiclePlacement,
      anchor?: { facing: number; from: Vec3 },
    ): Promise<SpawnedVehicle> => {
      const { heading, model } = placement;
      const { colliders, doors, halfExtents, handling, lod, object, parts, reflectiveMaterials, rig, seats, wheels } =
        await adapter.loadVehicle(model, placement.colour);
      const gap = halfExtents[1] + 2; // car half-length (COL bounds) + clearance, so it clears the player
      let position: Vec3 = anchor
        ? [
            anchor.from[0] - Math.sin(anchor.facing) * gap,
            anchor.from[1] + Math.cos(anchor.facing) * gap,
            anchor.from[2] + 0.5,
          ]
        : placement.position;
      // Map car generators (plan 059): seat the body on the ground beneath the IPL spot so it doesn't penetrate
      // terrain/props and get launched. Raycast from just above the generator; keep the original z if none found.
      if (!anchor && placement.groundSnap) {
        const ground = character.physics.groundBelow(
          [position[0], position[1], position[2] + GROUND_SNAP_LIFT],
          GROUND_SNAP_DROP,
        );
        if (ground !== null) {
          position = [position[0], position[1], ground + halfExtents[2] + 0.1];
        }
      }
      object.position.set(position[0], position[1], position[2]);
      object.rotation.z = heading;
      game.getStreamingRoot().add(object);
      reflection.register(reflectiveMaterials); // apply the active reflection preset to this car
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
        halfExtents,
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

      return {
        despawn: (): void => {
          vehiclePhysics.remove(vehicle);
          enterVehicle.remove(vehicle);
          vehicleDamage.remove(body);
          character.physics.removeVehicle(controller); // drop the raycast controller before its body
          character.physics.removeBodies([body]);
          reflection.unregister(reflectiveMaterials);
          game.getStreamingRoot().remove(object);
          disposeVehicle(object);
        },
        lod,
        object,
        position: live,
      };
    };

    const vehicleLod = new VehicleLodSystem(character.viewOf, game.getConfig(), spawnVehicle);
    game.addSystem(vehicleLod);
    // Parked cars come from the game's `parked.json` in the VFS (shipped per game); absent → none.
    for (const placement of parseParkedVehicles(fs.getText('parked.json'))) {
      vehicleLod.add(placement, await spawnVehicle(placement));
    }
    // Map-baked car generators (binary IPL CARS in gta3.img) — specific-model + random (resolved via the zone-type
    // popcycle, plan 059 B1). Registered lazily so the LOD stream spawns each only when the view nears it.
    for (const placement of await adapter.mapCarGenerators({
      cityAt: (x, y) => cityAt(x, y, orderedCityBoxes),
      hour: Math.floor(game.getHours()),
    })) {
      vehicleLod.register(placement);
    }

    // Flip the occupied car: a 180° roll about its forward axis (wheels ↔ roof), lifted clear of
    // the ground, via holdBody (one-shot teleport that also zeroes velocity).
    const flipVehicle = (): void => {
      const active = enterVehicle.getActive();
      if (!active) {
        return;
      }
      const { position, quaternion } = character.physics.readBody(active.body);
      const q = new Quaternion(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
      const forward = new Vector3(0, 1, 0).applyQuaternion(q); // car forward in world space
      const flipped = new Quaternion().setFromAxisAngle(forward, Math.PI).multiply(q);
      character.physics.holdBody(
        active.body,
        [position[0], position[1], position[2] + 1.5],
        [flipped.x, flipped.y, flipped.z, flipped.w],
      );
    };

    // Cars available in-game → drives the debug spawn list: every car defined in `vehicles.ide` (sorted).
    const vehicleModels = vehicleModelsFromIde(fs);

    // Cycle each car's OWN carcols combos on repeated debug spawns (so re-spawning gives a different
    // colour); undefined when the car has no carcols entry → loadVehicle picks its default.
    const colourCycle = new Map<string, number>();
    const nextVehicleColour = async (model: string): Promise<string | undefined> => {
      const combos = await adapter.vehicleColourCombos(model);
      if (combos.length === 0) {
        return undefined;
      }
      const index = colourCycle.get(model) ?? 0;
      colourCycle.set(model, index + 1);

      return combos[index % combos.length].join(',');
    };

    const debugActions: DebugActions = {
      bloom: () => game.getConfig().graphics.bloom,
      breakNearest: () => breakProp(nearestBreakable(character.viewOf(), 8)),
      camera: () => game.getConfig().camera,
      cameraDistance: () => game.getCameraDistance(),
      city: () => game.getCity(),
      clouds: () => game.getConfig().graphics.clouds,
      effects: () => game.getConfig().graphics.effects,
      flipVehicle,
      fogDistance: () => game.getConfig().fog.distance,
      gameTime: () => game.getTime(),
      godrays: () => game.getConfig().graphics.sun.godrays,
      godraysSize: () => game.getConfig().graphics.sun.godraysSize,
      headlights: () => game.getConfig().graphics.headlights,
      isFlying: () => character.controllerSystem.isFlying(),
      lights: () => game.getConfig().graphics.lights,
      moon: () => game.getConfig().graphics.moon,
      night: () => game.getConfig().graphics.night,
      playerCoords: () => character.viewOf(),
      procObj: () => game.getConfig().graphics.procobj,
      respawnPlayer: () => {
        const [x, y, z] = character.viewOf();
        character.placePlayer([x, y, z + 1], true); // re-drop slightly above the current spot to unstick
      },
      setBloom: (patch) => game.setBloom(patch),
      setCamera: (patch) => game.setCamera(patch),
      setClouds: (patch) => game.setClouds(patch),
      setEffects: (patch) => game.setEffects(patch),
      setFlyMode: (on) => {
        character.controllerSystem.setFlying(on);
        if (!on) {
          // Drop the player onto the ground directly beneath them (or leave them put if none is found).
          const [x, y, z] = character.viewOf();
          const ground = character.physics.groundBelow([x, y, z], FLY_GROUND_MAX_DROP);
          if (ground !== null) {
            character.placePlayer([x, y, ground + character.halfExtents[2]], true);
          }
        }
      },
      setFogDistance: (distance) => game.setFogDistance(distance),
      setGameTime: (minutes) => game.setTime(minutes),
      setGodrays: (enabled) => game.setGodrays(enabled),
      setGodraysSize: (size) => game.setGodraysSize(size),
      setHeadlights: (patch) => game.setHeadlights(patch),
      setLights: (patch) => game.setLights(patch),
      setMoon: (patch) => game.setMoon(patch),
      setNight: (patch) => game.setNight(patch),
      setProcObj: (category, patch) => {
        game.setProcObj(category, patch);
        if (patch.density !== undefined || patch.enabled !== undefined) {
          reloadClutterColliders(); // keep clutter collision in sync with the rendered set
        }
      },
      setShadows: (patch) => game.setShadows(patch),
      setShowFaces: (enabled) => game.setShowFaces(enabled),
      setShowNormals: (enabled) => game.setShowNormals(enabled),
      setSky: (patch) => game.setSky(patch),
      setSsao: (patch) => game.setSsao(patch),
      setStars: (patch) => game.setStars(patch),
      setStreaming: (patch) => game.setStreaming(patch),
      setSunSize: (size) => game.setSunSize(size),
      setToneMapping: (enabled) => game.setToneMapping(enabled),
      setVehicleReflection: (patch) => game.setVehicleReflection(patch),
      setWater: (patch) => game.setWater(patch),
      setWeather: (index) => game.setWeather(index),
      setWorldLight: (patch) => game.setWorldLight(patch),
      shadows: () => game.getConfig().graphics.shadows,
      sky: () => game.getConfig().graphics.sky,
      spawnVehicle: async (model) => {
        const facing = animationSystem.getFacing();
        const from = character.viewOf();
        const colour = await nextVehicleColour(model);
        const spawned = await spawnVehicle({ colour, heading: facing, model, position: from }, { facing, from });
        const at: Vec3 = [spawned.position[0], spawned.position[1], spawned.position[2]];
        vehicleLod.add({ colour, heading: facing, model, position: at }, spawned);
      },
      ssao: () => game.getConfig().graphics.ssao,
      stars: () => game.getConfig().graphics.stars,
      streaming: () => game.getConfig().streaming,
      sunSize: () => game.getConfig().graphics.sun.sunSize,
      teleport: (coords) => character.placePlayer(coords, true),
      teleportToGanton: () => character.placePlayer(spawn, true),
      toneMapping: () => game.getConfig().graphics.toneMapping,
      topDownView: () => game.topDownView(),
      vehicleModels: () => vehicleModels,
      vehicleReflection: () => game.getConfig().graphics.vehicleReflection,
      water: () => game.getConfig().graphics.water,
      weather: () => game.getWeather(),
      weatherList: () => WEATHERS,
      worldLight: () => game.getConfig().graphics.worldLight,
    };

    // On a touch device, add an on-screen-controls input source (the overlay drives it); the combiner merges
    // it with keyboard/mouse, so a 2-in-1 keeps both (plan 055).
    const touchInput = isTouchDevice() ? new TouchInputSource() : null;
    if (touchInput) {
      game.addInputSource(touchInput);
    }

    return { canEnterExit: () => enterVehicle.canEnterExit(), debugActions, game, touchInput };
  })();

  return bootstrapped;
}

/** Free a despawned car's GPU buffers. Materials only — textures are shared (generic vehicle TXD). */
function disposeVehicle(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as Partial<Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}
