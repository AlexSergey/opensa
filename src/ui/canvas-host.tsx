import { type ReactElement, useEffect, useRef, useState } from 'react';
import { type Mesh, type Object3D, Quaternion, type Texture, Vector3 } from 'three';

import type { CharacterPlacement } from '../game/character/orient-character';
import type { Vec3 } from '../game/interfaces/world-adapter.interface';
import type { SpawnedVehicle, VehiclePlacement } from '../game/vehicle/vehicle-lod.system';
import type { DebugActions } from './debug/debug-overlay';

import { Game } from '../game';
import { GtaSaWorldAdapter } from '../game/adapters/gta-sa-world.adapter';
import { AnimationController } from '../game/character/animation-controller';
import { CharacterAnimationSystem } from '../game/character/character-animation.system';
import { orientCharacter } from '../game/character/orient-character';
import { setupCharacter } from '../game/character/setup-character';
import { cloudProfile } from '../game/plugins/cloud-profile';
import { FogPlugin } from '../game/plugins/fog.plugin';
import { PostFxPlugin } from '../game/plugins/postfx.plugin';
import { SkyPlugin, type SkySample } from '../game/plugins/sky.plugin';
import { VehicleReflectionPlugin } from '../game/plugins/vehicle-reflection/vehicle-reflection.plugin';
import { WaterPlugin, type WaterSample } from '../game/plugins/water.plugin';
import { CollisionStreamingSystem } from '../game/streaming/collision-streaming.system';
import { StreamingSystem } from '../game/streaming/streaming.system';
import { clockNightFactor } from '../game/time/hour-window';
import { TimedObjectSystem } from '../game/time/timed-object.system';
import { EnterVehicleSystem } from '../game/vehicle/enter-vehicle.system';
import { VehicleDamageSystem } from '../game/vehicle/vehicle-damage.system';
import { VehicleHeadlightSystem } from '../game/vehicle/vehicle-headlight.system';
import { VehicleLodSystem } from '../game/vehicle/vehicle-lod.system';
import { VehiclePhysicsSystem } from '../game/vehicle/vehicle-physics.system';
import {
  buildTextureMap,
  coronaMaterial,
  nightColorUniform,
  parseTxd,
  sampleTimecycBlend,
  WEATHER_NAMES,
} from '../renderware';
import { DebugOverlay } from './debug/debug-overlay';
import { Hud } from './hud/hud';
import { loadFonts } from './hud/load-fonts';
import { Overlay } from './hud/overlay';
import { GANTON_CJ_HOME, GANTON_RADIUS, PLAYER_SPAWN } from './locations';

const BASE = import.meta.env.VITE_STATIC_URL;

const CELL_SIZE = 250; // streaming grid cell edge — shared by Config.streaming + the adapter

// Player collision box (half-extents) — a human, decoupled from the T-pose mesh bbox.
const PLAYER_HALF_EXTENTS: Vec3 = [0.3, 0.3, 0.9];
// The animation (idle/walk) stands the skeleton up in GTA Z-up, so the model needs
// NO rotation; offset nudges the feet onto the box base. (Tune offset/scale here.)
const TOMMY_PLACEMENT: CharacterPlacement = { offset: [0, 0, 0.04], rotation: [0, 0, 0], scale: 1 };

// Initial paint per model — carcols.dat palette indices (first two = primary/secondary).
const CAR_COLORS: Record<string, string> = { admiral: '37,37', camper: '0,6,3,0' };

// Default timecyc weather (index into WEATHER_NAMES; 0 = EXTRASUNNY_LA).
const DEFAULT_WEATHER = 0;

// Selectable weathers for the debug Weather tab — all timecyc weathers except rain/storm/underwater
// and the cutscene EXTRACOLOURS entries (per the "sunny/cloudy/etc, no rain/storm" ask).
const WEATHERS: readonly { index: number; label: string }[] = WEATHER_NAMES.map((label, index) => ({
  index,
  label,
})).filter(({ label }) => !/RAINY|SANDSTORM|UNDERWATER|EXTRACOLOUR/.test(label));

// Static cars parked on the Ganton lot near the spawn (native Z-up; heading about Z).
// admiral = 2-colour paint, camper = 4-colour. Positions/z/heading tuned in-browser.
const VEHICLE_PLACEMENTS: readonly VehiclePlacement[] = [
  { colour: CAR_COLORS.admiral, heading: 0, model: 'admiral', position: [2502, -1678, 13.4] },
  // Camper next to the admiral on the same flat strip (to compare start behaviour at a known-OK spot).
  { colour: CAR_COLORS.camper, heading: 0, model: 'camper', position: [2496, -1678, 13.4] },
];

interface Bootstrap {
  debugActions: DebugActions;
  game: Game;
}

/** Fetch + parse a standalone .txd into a name→Texture map (null on any failure). */
async function loadTxd(url: string): Promise<Map<string, Texture> | null> {
  try {
    return buildTextureMap(parseTxd(await fetch(url).then((response) => response.arrayBuffer())));
  } catch {
    return null;
  }
}

// One bootstrap per page load, kept at module scope so React StrictMode's
// double-mount (dev) doesn't spin up a second renderer / archive download.
let bootstrapped: null | Promise<Bootstrap> = null;

/**
 * The single React surface: mounts the canvas the {@link Game} renders into and
 * the DOM debug overlay. React never touches the scene graph — it just wires the
 * canvas, forwards resize/pointer events, and shows load state.
 */
export function CanvasHost(): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [game, setGame] = useState<Game | null>(null);
  const [actions, setActions] = useState<DebugActions | null>(null);
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
          setGame(ready.game);
          setActions(ready.debugActions);
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
      if (e.key === 'F2' && fly) {
        setFly(false); // entering the debugger leaves fly mode
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

  return (
    <>
      <canvas onClick={handleClick} ref={canvasRef} style={{ display: 'block', height: '100%', width: '100%' }} />
      {phase === 'loading' && <LoadOverlay text="Loading map…" />}
      {phase === 'error' && <LoadOverlay text={`Failed to load map: ${errorText}`} />}
      {game && (
        <Overlay>
          <Hud game={game} />
        </Overlay>
      )}
      {game && actions && <DebugOverlay actions={actions} game={game} />}
    </>
  );
}

function bootstrap(canvas: HTMLCanvasElement): Promise<Bootstrap> {
  bootstrapped ??= (async (): Promise<Bootstrap> => {
    const game = Game.getInstance(canvas, {
      camera: { followDistance: 12, followMaxPolar: Math.PI / 2 - 0.05, followMinPolar: 0.25, followZoom: true },
      controls: { back: 'KeyS', forward: 'KeyW', jump: 'Space', left: 'KeyA', right: 'KeyD', run: 'ShiftLeft' },
      fog: { distance: 800 },
      fonts: { hud: { clock: 'SixCaps-Regular' } },
      gameState: 'play',
      graphics: {
        bloom: { enabled: true, intensity: 0.7, threshold: 0.7 },
        clouds: { coverage: 0.5, opacity: 0.85 },
        headlights: { angle: Math.PI / 7, distance: 60, glow: 0.68, intensity: 13 },
        lights: { enabled: true, nightEndHour: 6, nightStartHour: 20 },
        moon: { brightness: 1, elevationDeg: 5, size: 55 },
        night: {
          coronaDrawDistance: 120,
          grade: 0.05,
          litFade: { dawnEnd: 7, dawnStart: 6, duskEnd: 21, duskStart: 20 },
          skylight: 0.6,
          tint: [1.0, 1.0, 1.0],
          windowGlow: 1.0,
        },
        shadows: { enabled: true },
        sky: { density: 0.96, exposure: 0.5, weight: 0.4 },
        ssao: { enabled: true, intensity: 1.5, radius: 0.2 },
        stars: { enabled: true },
        sun: { godrays: true, godraysSize: 30, sunSize: 15 },
        toneMapping: true,
        vehicleReflection: { intensity: 0.25, preset: 'enhanced' },
        water: { darkness: 0.75, glint: 0.9, reflection: 0.35 },
      },
      hud: { clock: { borderColor: '#000', borderWidth: 1, color: '#fff', fontSize: 52 } },
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
    const adapter = new GtaSaWorldAdapter({
      archiveUrl: `${BASE}/models/gta3-original.img`,
      base: BASE,
      cellSize: CELL_SIZE,
      datUrl: `${BASE}/data/gta.dat`,
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
    const particleTextures = await loadTxd(`${BASE}/models/particle.txd`);
    const moonTexture = particleTextures?.get('coronamoon') ?? null;
    const sky = new SkyPlugin(skySample, () => game.getHours(), moonTexture); // sky dome + sun/moon + lights
    const reflection = new VehicleReflectionPlugin(() => game.getHours()); // sky-probe reflections on spawned cars

    // Water mesh (geometry from the adapter) loaded up front so the WaterPlugin can own its material;
    // parented under the −90°X streaming root (which `game.init` adds to the scene).
    const water = await adapter.loadWater(`${BASE}/data/water.dat`, `${BASE}/models/particle.txd`);
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
      .addPlugin(new PostFxPlugin(sky.godraysSource, () => game.getHours())); // post-FX host: god rays + bloom + tone mapping

    await loadFonts(game.getConfig().fonts); // register HUD fonts before the scene/HUD render
    await game.init();
    // 6:00, EXTRASUNNY (weather is a load/session param like the start time, not engine config).
    await game.loadGame(GANTON_CJ_HOME, { radius: GANTON_RADIUS, startMinutes: 360, weather: DEFAULT_WEATHER });

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

    // Show/hide time-of-day (tobj) objects (lit-window night variants, etc.) by the game hour.
    game.addSystem(new TimedObjectSystem(game.getStreamingRoot(), () => game.getHours()));

    // Night lights ride two signals: the **coronas** cross-fade by the smooth sun-height night factor
    // (`sky.godraysSource.userData.night`) so they fade with the ambient at dusk/dawn; the baked **night vertex
    // colours** (and the ACES night tonemap, in PostFxPlugin) instead ride a fixed wall-CLOCK schedule —
    // `clockNightFactor(hour, night.litFade)` — so lit windows switch on at set hours (tunable in debug →
    // Atmosphere). Neither uses the hard 20→6 lamp hour-window, which snapped lamps off out of sync.
    game.addSystem({
      name: 'coronas',
      update(): void {
        const { lights, night } = game.getConfig().graphics;
        const nightFactor = (sky.godraysSource.userData.night as number | undefined) ?? 0;
        coronaMaterial.uniforms.uOn.value = lights.enabled ? nightFactor : 0;
        coronaMaterial.uniforms.uViewportHeight.value = canvas.height || canvas.clientHeight;
        coronaMaterial.uniforms.uDrawDistance.value = night.coronaDrawDistance;
        // Night vertex colours ride a fixed CLOCK schedule (see clockNightFactor) instead of the sun-height
        // signal, so lit windows switch on a wall-clock time. The ACES night tonemap rides the same schedule.
        nightColorUniform.value = clockNightFactor(game.getHours(), night.litFade) * night.windowGlow;
      },
    });

    // Stream static collision (HD cells) around the player so it has ground everywhere.
    game.addSystem(new CollisionStreamingSystem(adapter, character.physics, character.viewOf, game.getConfig()));

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
    // Night headlights on the occupied car (texture swap + a forward-down spotlight), gated on seated + night.
    game.addSystem(
      new VehicleHeadlightSystem(
        enterVehicle,
        () => game.isNight(),
        game.getStreamingRoot(),
        () => game.getConfig().graphics.headlights,
      ),
    );

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
      const position: Vec3 = anchor
        ? [
            anchor.from[0] - Math.sin(anchor.facing) * gap,
            anchor.from[1] + Math.cos(anchor.facing) * gap,
            anchor.from[2] + 0.5,
          ]
        : placement.position;
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
    for (const placement of VEHICLE_PLACEMENTS) {
      vehicleLod.add(placement, await spawnVehicle(placement));
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

    const debugActions: DebugActions = {
      bloom: () => game.getConfig().graphics.bloom,
      clouds: () => game.getConfig().graphics.clouds,
      flipVehicle,
      fogDistance: () => game.getConfig().fog.distance,
      gameTime: () => game.getTime(),
      godrays: () => game.getConfig().graphics.sun.godrays,
      godraysSize: () => game.getConfig().graphics.sun.godraysSize,
      headlights: () => game.getConfig().graphics.headlights,
      lights: () => game.getConfig().graphics.lights,
      moon: () => game.getConfig().graphics.moon,
      night: () => game.getConfig().graphics.night,
      playerCoords: () => character.viewOf(),
      respawnPlayer: () => {
        const [x, y, z] = character.viewOf();
        character.placePlayer([x, y, z + 1], true); // re-drop slightly above the current spot to unstick
      },
      setBloom: (patch) => game.setBloom(patch),
      setClouds: (patch) => game.setClouds(patch),
      setFogDistance: (distance) => game.setFogDistance(distance),
      setGameTime: (minutes) => game.setTime(minutes),
      setGodrays: (enabled) => game.setGodrays(enabled),
      setGodraysSize: (size) => game.setGodraysSize(size),
      setHeadlights: (patch) => game.setHeadlights(patch),
      setLights: (patch) => game.setLights(patch),
      setMoon: (patch) => game.setMoon(patch),
      setNight: (patch) => game.setNight(patch),
      setShadows: (patch) => game.setShadows(patch),
      setSky: (patch) => game.setSky(patch),
      setSsao: (patch) => game.setSsao(patch),
      setStars: (patch) => game.setStars(patch),
      setSunSize: (size) => game.setSunSize(size),
      setToneMapping: (enabled) => game.setToneMapping(enabled),
      setVehicleReflection: (patch) => game.setVehicleReflection(patch),
      setWater: (patch) => game.setWater(patch),
      setWeather: (index) => game.setWeather(index),
      shadows: () => game.getConfig().graphics.shadows,
      sky: () => game.getConfig().graphics.sky,
      spawnVehicle: async (model) => {
        const facing = animationSystem.getFacing();
        const from = character.viewOf();
        const colour = CAR_COLORS[model];
        const spawned = await spawnVehicle({ colour, heading: facing, model, position: from }, { facing, from });
        const at: Vec3 = [spawned.position[0], spawned.position[1], spawned.position[2]];
        vehicleLod.add({ colour, heading: facing, model, position: at }, spawned);
      },
      ssao: () => game.getConfig().graphics.ssao,
      stars: () => game.getConfig().graphics.stars,
      sunSize: () => game.getConfig().graphics.sun.sunSize,
      teleport: (coords) => character.placePlayer(coords, true),
      teleportToGanton: () => character.placePlayer(PLAYER_SPAWN, true),
      toneMapping: () => game.getConfig().graphics.toneMapping,
      topDownView: () => game.topDownView(),
      vehicleReflection: () => game.getConfig().graphics.vehicleReflection,
      water: () => game.getConfig().graphics.water,
      weather: () => game.getWeather(),
      weatherList: () => WEATHERS,
    };

    return { debugActions, game };
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

function LoadOverlay({ text }: { text: string }): ReactElement {
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
