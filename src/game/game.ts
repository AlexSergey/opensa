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

import { CollisionWorld } from './collision/collision-world';
import { CameraController } from './core/camera-controller';
import { Clock } from './core/clock';
import { createRenderContext } from './core/renderer';
import { type System, SystemRegistry } from './core/system';
import { EventBus } from './events/event-bus';
import { type GameEvents } from './events/events.global';
import { type Config, type GameState } from './interfaces/config.interface';
import { type RegionRequest, type Vec3, type WorldAdapter } from './interfaces/world-adapter.interface';
import { type Plugin, type PluginContext, type RenderPipeline } from './plugins/plugin';
import { BasicRenderPipeline } from './plugins/render-pipeline';

const FIXED_STEP = 1 / 60;

interface LoadOptions {
  geometry?: 'lods' | 'map';
  radius?: number;
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
  private readonly collisionWorld = new CollisionWorld();
  private readonly config: Config;
  private context: null | PluginContext = null;
  private readonly entityRoot = new Group();
  private lastRequest: null | RegionRequest = null;
  private pipeline!: RenderPipeline;
  private readonly plugins: Plugin[] = [];
  private readonly raycaster = new Raycaster();
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private started = false;
  private readonly systems = new SystemRegistry();
  private readonly worldObjects: Object3D[] = [];

  private constructor(canvas: HTMLCanvasElement, config: Config) {
    this.canvas = canvas;
    this.config = config;
    // Dynamic entities (the player, later NPCs/vehicles) live in GTA Z-up; the
    // −90°X here is display-only, matching the region group. Physics stays Z-up.
    this.entityRoot.name = 'EntityRoot';
    this.entityRoot.rotation.x = -Math.PI / 2;
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
    for (const object of [...this.worldObjects, ...this.collisionObjects]) {
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

  /** The static-world collision for the current region (empty until loadColliders). */
  getCollisionWorld(): CollisionWorld {
    return this.collisionWorld;
  }

  /** The live config (mutated in place by `setConfig`); systems read it for state. */
  getConfig(): Readonly<Config> {
    return this.config;
  }

  /** Root group for dynamic entity meshes (player, NPCs). Native GTA Z-up content. */
  getEntityRoot(): Group {
    return this.entityRoot;
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

  /** Populate the collision world for the current region (for a physics system). */
  async loadColliders(): Promise<void> {
    if (!this.adapter || !this.lastRequest) {
      this.collisionWorld.clear();

      return;
    }
    this.collisionWorld.set(await this.adapter.loadColliders(this.lastRequest));
  }

  async loadGame(center: Vec3, options: LoadOptions = {}): Promise<void> {
    if (!this.adapter) {
      throw new Error('Game.loadGame requires a world adapter (setWorldAdapter)');
    }
    this.events.emit('loading', { fraction: 0 });
    await this.adapter.prepare((fraction) => this.events.emit('loading', { fraction }));

    for (const object of this.worldObjects) {
      this.scene.remove(object);
      disposeObject(object);
    }
    this.worldObjects.length = 0;

    const request: RegionRequest = { center, geometry: options.geometry ?? 'map', radius: options.radius ?? 500 };
    this.lastRequest = request;
    const objects = await this.adapter.loadRegion(request);
    for (const object of objects) {
      this.scene.add(object);
      this.worldObjects.push(object);
    }
    this.cameraController.frameObjects(objects);
    this.collisionWorld.clear(); // region-scoped; a physics layer repopulates via loadColliders()
    await this.refreshCollision();
    this.events.emit('loaded');
  }

  /** Raycast at normalized device coords (-1..1) and emit the picked object info. */
  pick(ndcX: number, ndcY: number): void {
    if (!this.adapter) {
      return;
    }
    this.raycaster.setFromCamera(new Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.intersectObjects(this.worldObjects, true).find((it) => it.instanceId !== undefined);
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

  setConfig(patch: Partial<Config>): void {
    Object.assign(this.config, patch); // mutate in place so PluginContext.config stays live
    for (const plugin of this.plugins) {
      plugin.configChanged?.(this.config);
    }
  }

  setDebugMode(enabled: boolean): void {
    this.setConfig({ debugMode: enabled });
    this.cameraController.setMode(enabled ? 'debug' : 'follow');
    this.events.emit('debug-mode', { enabled });
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

  /** Toggle the collision wireframe overlay for the current region (debug). */
  setShowCollision(enabled: boolean): void {
    this.setConfig({ showCollision: enabled });
    void this.refreshCollision();
  }

  setWorldAdapter(adapter: WorldAdapter): this {
    this.adapter = adapter;

    return this;
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
      this.cameraController.update();
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
