import {
  Group,
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';

import type { StreamingSystem } from './streaming/streaming.system';
import type { City } from './zones/city';

import { CameraController } from './core/camera-controller';
import { Clock } from './core/clock';
import { createRenderContext } from './core/renderer';
import { type System, SystemRegistry } from './core/system';
import { Logger } from './diagnostics/logger';
import { EventBus } from './events/event-bus';
import { type GameEvents } from './events/events.global';
import {
  type BloomConfig,
  type CloudsConfig,
  type Config,
  type GameState,
  type HeadlightConfig,
  type LightsConfig,
  type MoonConfig,
  type NightConfig,
  type ShadowsConfig,
  type SkyConfig,
  type SsaoConfig,
  type StarsConfig,
  type SunConfig,
  type VehicleReflectionConfig,
  type WaterConfig,
} from './interfaces/config.interface';
import { type RegionRequest, type Vec3, type WorldAdapter } from './interfaces/world-adapter.interface';
import { type Plugin, type PluginContext, type RenderPipeline } from './plugins/plugin';
import { BasicRenderPipeline } from './plugins/render-pipeline';
import { type CellCoord } from './streaming/grid';
import { GameClock } from './time/game-clock';
import { inHourWindow } from './time/hour-window';
import { type WeatherBlend, WeatherTransition } from './weather/weather-transition';

const FIXED_STEP = 1 / 60;
/** Engine default weather before a world is loaded (loadGame seeds the real one). */
const DEFAULT_WEATHER = 0;

interface LoadOptions {
  /** Radius (world units) the collision zone is built for; streaming handles render. */
  radius?: number;
  /** Start time of day in minutes since midnight (e.g. 360 = 6:00); defaults to noon. */
  startMinutes?: number;
  /** Initial timecyc weather index (into WEATHER_NAMES); defaults to {@link DEFAULT_WEATHER}. */
  weather?: number;
}

/**
 * The engine, as a singleton wrapper. Framework-agnostic: it owns the
 * renderer/scene/camera (built from a canvas) + an OrbitControls camera
 * controller, installs plugins, runs the loop (fixed-step systems → camera →
 * plugin update → pipeline render), loads the world through a {@link WorldAdapter},
 * and raycasts for picking. UI drives it via methods + the typed event bus.
 */
export class Game {
  private static instance: Game | null = null;

  readonly events = new EventBus<GameEvents>();

  private accumulator = 0;
  private adapter: null | WorldAdapter = null;
  private camera!: PerspectiveCamera;
  private cameraController!: CameraController;
  private readonly canvas: HTMLCanvasElement;
  private readonly clock = new Clock();
  private readonly collisionObjects: Object3D[] = [];
  private readonly config: Config;
  private context: null | PluginContext = null;
  private currentCity: City = 'COUNTRYSIDE';
  private readonly entityRoot = new Group();
  private readonly gameClock = new GameClock();
  private lastRequest: null | RegionRequest = null;
  private readonly logger: Logger;
  private pipeline!: RenderPipeline;
  private readonly plugins: Plugin[] = [];
  private readonly raycaster = new Raycaster();
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private started = false;
  private readonly streamingRoot = new Group();
  private streamingSystem: null | StreamingSystem = null;
  private readonly systems = new SystemRegistry();
  private readonly weatherTransition: WeatherTransition;

  private constructor(canvas: HTMLCanvasElement, config: Config) {
    this.canvas = canvas;
    this.config = config;
    this.weatherTransition = new WeatherTransition(DEFAULT_WEATHER);
    this.logger = new Logger(this.events, this.config);
    // Dynamic entities (the player, later NPCs/vehicles) live in GTA Z-up; the
    // −90°X here is display-only, matching the region group. Physics stays Z-up.
    this.entityRoot.name = 'EntityRoot';
    this.entityRoot.rotation.x = -Math.PI / 2;
    // Streamed map cells live in GTA Z-up too; one −90°X for the whole streaming root.
    this.streamingRoot.name = 'StreamingRoot';
    this.streamingRoot.rotation.x = -Math.PI / 2;
  }

  static getInstance(canvas?: HTMLCanvasElement, config?: Config): Game {
    if (!Game.instance) {
      if (!canvas || !config) {
        throw new Error('Game.getInstance requires a canvas and config on first call');
      }
      Game.instance = new Game(canvas, config);
    }

    return Game.instance;
  }

  addPlugin(plugin: Plugin): this {
    this.plugins.push(plugin);

    return this;
  }

  /** Register a system; the loop runs `fixedUpdate(step)` then `update(delta)` on it. */
  addSystem(system: System): this {
    this.systems.add(system);

    return this;
  }

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.cameraController.dispose();
    for (const plugin of this.plugins) {
      plugin.dispose?.();
    }
    for (const object of this.collisionObjects) {
      disposeObject(object);
    }
    this.renderer.dispose();
    Game.instance = null;
  }

  /** Point the camera at a spawned entity once (initial framing; `setFollowTarget` trails it). */
  frameEntity(object: Object3D, distance = 20): void {
    this.entityRoot.updateMatrixWorld(true);
    this.cameraController.focus(object.getWorldPosition(new Vector3()), distance);
  }

  /** The scene camera (read-only handle; e.g. for camera-relative input). */
  getCamera(): PerspectiveCamera {
    return this.camera;
  }

  /** The city the player is currently in (driven by {@link CityZoneSystem}); Countryside until a world loads. */
  getCity(): City {
    return this.currentCity;
  }

  /** The live config (mutated in place by `setConfig`); systems read it for state. */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  /** Root group for dynamic entity meshes (player, NPCs). Native GTA Z-up content. */
  getEntityRoot(): Group {
    return this.entityRoot;
  }

  /** Continuous in-game time of day in hours (0–24, fractional) — for smooth consumers (sun/sky). */
  getHours(): number {
    return this.gameClock.exactMinutes / 60;
  }

  /** Shared diagnostics logger; pass to systems so they can emit gated `'log'` events. */
  getLogger(): Logger {
    return this.logger;
  }

  /** Root group the streaming system adds/removes map cells under (native GTA Z-up). */
  getStreamingRoot(): Group {
    return this.streamingRoot;
  }

  /** Current in-game time, minutes since midnight (0–1439). */
  getTime(): number {
    return this.gameClock.minutes;
  }

  /** The grid cell the streaming view is in (null until streaming is wired). */
  getViewCell(): CellCoord | null {
    return this.streamingSystem?.viewCell() ?? null;
  }

  /** Active timecyc weather index (the committed target; the UI shows this as selected). */
  getWeather(): number {
    return this.weatherTransition.target;
  }

  /** Live weather blend (from/to indices + eased `t`) for the samplers — drives smooth transitions. */
  getWeatherBlend(): WeatherBlend {
    return this.weatherTransition.blend();
  }

  async init(): Promise<void> {
    if (this.context) {
      return; // already initialized
    }
    const { camera, renderer, scene } = createRenderContext(this.canvas);
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.scene.add(this.entityRoot);
    this.scene.add(this.streamingRoot);
    this.cameraController = new CameraController(camera, renderer.domElement, this.config);
    this.pipeline = new BasicRenderPipeline(renderer, scene, camera);
    this.context = {
      camera,
      clock: this.clock,
      config: this.config,
      events: this.events,
      pipeline: this.pipeline,
      renderer,
      scene,
    };

    for (const plugin of this.plugins) {
      await plugin.install(this.context);
    }

    this.start();
    this.events.emit('ready');
  }

  /** Whether it's "night" by the configured lamp hours (`graphics.lights.nightStartHour/EndHour`). The single
   *  hour-based night signal for night lights — coronas + vehicle headlights (the master `lights.enabled`
   *  toggle is applied per-feature by callers). Distinct from `SkyPlugin`'s sun-height factor for atmosphere. */
  isNight(): boolean {
    const lights = this.config.graphics.lights;

    return inHourWindow(((this.getHours() % 24) + 24) % 24, lights.nightStartHour, lights.nightEndHour);
  }

  /** Every grid cell that holds content (for the debug section inspector). */
  listCells(): CellCoord[] {
    return this.adapter?.listCells() ?? [];
  }

  async loadGame(center: Vec3, options: LoadOptions = {}): Promise<void> {
    if (!this.adapter) {
      throw new Error('Game.loadGame requires a world adapter (setWorldAdapter)');
    }
    this.gameClock.set(options.startMinutes ?? 720); // default noon
    this.weatherTransition.begin(options.weather ?? DEFAULT_WEATHER, 0); // seed weather instantly (no ease)
    this.events.emit('loading', { fraction: 0 });
    await this.adapter.prepare((fraction) => this.events.emit('loading', { fraction }));

    // The map renders via the StreamingSystem (cells follow the view); loadGame just
    // prepares the adapter and seeds the collision zone around `center`.
    this.lastRequest = { center, geometry: 'map', radius: options.radius ?? 500 };
    await this.refreshCollision();
    this.events.emit('loaded');
  }

  /** Raycast at normalized device coords (-1..1) and emit the picked object info. */
  pick(ndcX: number, ndcY: number): void {
    if (!this.adapter) {
      return;
    }
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster
      .intersectObjects(this.streamingRoot.children, true)
      .find((it) => it.instanceId !== undefined);
    this.events.emit('select', hit ? this.adapter.describe(hit.object, hit.instanceId) : null);
  }

  resize(width: number, height: number): void {
    if (!this.context) {
      return;
    }
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    for (const plugin of this.plugins) {
      plugin.resize?.(width, height);
    }
  }

  /** Tune bloom (enabled/intensity/threshold) at runtime; merges into `graphics.bloom`. */
  setBloom(patch: Partial<BloomConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, bloom: { ...this.config.graphics.bloom, ...patch } } });
  }

  /** Tune the water shader (glint/reflection) at runtime; merges into `graphics.water`. */
  /** Set the player's current city (from {@link CityZoneSystem}); emits `'city'` only on a real change. */
  setCity(city: City): void {
    if (city !== this.currentCity) {
      this.currentCity = city;
      this.events.emit('city', { city });
    }
  }

  /** Tune procedural sky clouds (coverage/opacity) at runtime; merges into `graphics.clouds`. */
  setClouds(patch: Partial<CloudsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, clouds: { ...this.config.graphics.clouds, ...patch } } });
  }

  setConfig(patch: Partial<Config>): void {
    Object.assign(this.config, patch); // mutate in place so PluginContext.config stays live
    this.broadcastConfigChanged();
  }

  /** Swing the follow camera to a given orbit azimuth (yaw about world up). */
  /** Detach the camera for free-fly screenshots (arrows move, mouse looks); off → resume follow. */
  setFlyCamera(enabled: boolean): void {
    this.cameraController.setMode(enabled ? 'fly' : 'follow');
    this.events.emit('fly-camera', { enabled });
  }

  /** Change the distance fog range at runtime (world units to full fog). */
  setFogDistance(distance: number): void {
    this.setConfig({ fog: { distance } });
  }

  setFollowAzimuth(azimuth: number): void {
    this.cameraController.setAzimuth(azimuth);
  }

  /** The object the camera trails in follow mode (null = none). */
  setFollowTarget(object: null | Object3D): void {
    this.cameraController.setTarget(object);
  }

  /** Switch between play (physics + control) and pause (frozen). */
  setGameState(state: GameState): void {
    this.setConfig({ gameState: state });
    this.events.emit('game-state', { state });
  }

  /** Toggle the god-rays post-effect at runtime. */
  setGodrays(enabled: boolean): void {
    this.setSun({ godrays: enabled });
  }

  /** Change the god-rays light-source size at runtime (shaft strength; independent of the disc). */
  setGodraysSize(godraysSize: number): void {
    this.setSun({ godraysSize });
  }

  /** Tune vehicle headlights (beam size/reach/strength) at runtime; merges into `graphics.headlights`. */
  setHeadlights(patch: Partial<HeadlightConfig>): void {
    this.setConfig({
      graphics: { ...this.config.graphics, headlights: { ...this.config.graphics.headlights, ...patch } },
    });
  }

  /** Tune night light sources (coronas) at runtime; merges into `graphics.lights`. */
  setLights(patch: Partial<LightsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, lights: { ...this.config.graphics.lights, ...patch } } });
  }

  /** Debug: render an explicit set of cells at one detail level (null resumes streaming). */
  setManualCells(cells: CellCoord[] | null, lod = false): void {
    this.streamingSystem?.setManualCells(cells, lod);
  }

  setMapViewer(enabled: boolean): void {
    this.setConfig({ mapViewer: enabled });
    this.cameraController.setMode(enabled ? 'debug' : 'follow');
    this.events.emit('map-viewer', { enabled });
  }

  /** Tune the night moon (size/glow/elevation) at runtime; merges into `graphics.moon`. */
  setMoon(patch: Partial<MoonConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, moon: { ...this.config.graphics.moon, ...patch } } });
  }

  /** Tune night ambient/atmosphere (brightness/tint) at runtime; merges into `graphics.night`. */
  setNight(patch: Partial<NightConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, night: { ...this.config.graphics.night, ...patch } } });
  }

  /** Toggle sun shadows at runtime; merges into `graphics.shadows`. */
  setShadows(patch: Partial<ShadowsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, shadows: { ...this.config.graphics.shadows, ...patch } } });
  }

  /** Toggle the collision wireframe overlay for the current region (debug). */
  setShowCollision(enabled: boolean): void {
    this.setConfig({ showCollision: enabled });
    void this.refreshCollision();
  }

  /** Tune the god-rays shader (density/exposure/weight) at runtime; merges into `graphics.sky`. */
  setSky(patch: Partial<SkyConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, sky: { ...this.config.graphics.sky, ...patch } } });
  }

  /** Tune SSAO (enabled/intensity/radius) at runtime; merges into `graphics.ssao`. */
  setSsao(patch: Partial<SsaoConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, ssao: { ...this.config.graphics.ssao, ...patch } } });
  }

  /** Toggle night stars at runtime; merges into `graphics.stars`. */
  setStars(patch: Partial<StarsConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, stars: { ...this.config.graphics.stars, ...patch } } });
  }

  /** Register the streaming system so the engine can drive it (view cell, manual cells). */
  setStreamingSystem(system: StreamingSystem): void {
    this.streamingSystem = system;
  }

  /** Tune the sun disc + god-rays source at runtime; merges into `graphics.sun`. */
  setSun(patch: Partial<SunConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, sun: { ...this.config.graphics.sun, ...patch } } });
  }

  /** Change the sun disc base size at runtime (world units; timecyc scales it per hour). */
  setSunSize(sunSize: number): void {
    this.setSun({ sunSize });
  }

  /** Jump the in-game clock to a time (minutes since midnight); emits `'time'`. */
  setTime(minutes: number): void {
    this.gameClock.set(minutes);
    this.emitTime();
  }

  /** Toggle ACES tone mapping at runtime. */
  setToneMapping(enabled: boolean): void {
    this.setConfig({ graphics: { ...this.config.graphics, toneMapping: enabled } });
  }

  /** Tune vehicle reflections (preset/intensity) at runtime; merges into `graphics.vehicleReflection`. */
  setVehicleReflection(patch: Partial<VehicleReflectionConfig>): void {
    const vehicleReflection = { ...this.config.graphics.vehicleReflection, ...patch };
    this.setConfig({ graphics: { ...this.config.graphics, vehicleReflection } });
  }

  setWater(patch: Partial<WaterConfig>): void {
    this.setConfig({ graphics: { ...this.config.graphics, water: { ...this.config.graphics.water, ...patch } } });
  }

  /** Switch the active timecyc weather (index into WEATHER_NAMES); eases over `weatherTransitionSeconds`. */
  setWeather(weather: number): void {
    this.weatherTransition.begin(weather, this.config.weatherTransitionSeconds);
    this.broadcastConfigChanged(); // refresh weather-dependent plugins (e.g. the reflection sky probe)
  }

  setWorldAdapter(adapter: WorldAdapter): this {
    this.adapter = adapter;

    return this;
  }

  /** Snap the map-inspector (debug) camera back to top-down (undo a RIGHT-drag orbit). No-op outside it. */
  topDownView(): void {
    this.cameraController.topDownDebugView();
  }

  /** Notify every plugin that config (or weather) changed, so they can refresh derived state. */
  private broadcastConfigChanged(): void {
    for (const plugin of this.plugins) {
      plugin.configChanged?.(this.config);
    }
  }

  /** Broadcast the current clock minute (event for UI/timecyc, console log for now). */
  private emitTime(): void {
    const minutes = this.gameClock.minutes;
    this.events.emit('time', { minutes });
    this.logger.log('time', GameClock.format(minutes));
  }

  /** Rebuild the collision overlay for the current region (or clear it when off). */
  private async refreshCollision(): Promise<void> {
    for (const object of this.collisionObjects) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.collisionObjects.length = 0;
    if (!this.adapter || !this.lastRequest || !this.config.showCollision) {
      return;
    }
    const objects = await this.adapter.loadCollisionDebug(this.lastRequest);
    if (!this.config.showCollision) {
      objects.forEach(disposeObject); // toggled off while awaiting

      return;
    }
    for (const object of objects) {
      this.scene.add(object);
      this.collisionObjects.push(object);
    }
  }

  private start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    this.renderer.setAnimationLoop((now) => {
      const delta = this.clock.tick(now);
      this.accumulator += delta;
      while (this.accumulator >= FIXED_STEP) {
        this.systems.fixedUpdate(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.systems.update(delta);
      this.cameraController.update(delta);
      this.weatherTransition.tick(delta); // ease an in-progress weather change (real-time, runs while paused)
      // The clock only ticks while playing — pausing the game freezes the time of day.
      if (this.config.gameState === 'play' && this.gameClock.advance(delta, this.config.time.secondsPerGameMinute)) {
        this.emitTime();
      }
      if (this.context) {
        for (const plugin of this.plugins) {
          plugin.update?.(this.context);
        }
      }
      this.pipeline.render();
    });
  }
}

/**
 * Free GPU geometry/material of an object tree (meshes and line segments alike).
 * Textures are shared/cached — left intact.
 */
function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    const renderable = node as Partial<Mesh>;
    renderable.geometry?.dispose();
    const material = renderable.material;
    if (Array.isArray(material)) {
      material.forEach((entry) => entry.dispose());
    } else {
      material?.dispose();
    }
  });
}
