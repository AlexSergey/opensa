import {
  type Mesh,
  type Object3D,
  type PerspectiveCamera,
  Raycaster,
  type Scene,
  Vector2,
  type WebGLRenderer,
} from 'three';

import { CameraController } from './core/camera-controller';
import { Clock } from './core/clock';
import { createRenderContext } from './core/renderer';
import { SystemRegistry } from './core/system';
import { EventBus } from './events/event-bus';
import { type GameEvents } from './events/events.global';
import { type Config } from './interfaces/config.interface';
import { type Vec3, type WorldAdapter } from './interfaces/world-adapter.interface';
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
  private readonly config: Config;
  private context: null | PluginContext = null;
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

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.cameraController.dispose();
    for (const plugin of this.plugins) {
      plugin.dispose?.();
    }
    for (const object of this.worldObjects) {
      disposeObject(object);
    }
    this.renderer.dispose();
    Game.instance = null;
  }

  async init(): Promise<void> {
    if (this.context) {
      return; // already initialized
    }
    const { camera, renderer, scene } = createRenderContext(this.canvas);
    this.camera = camera;
    this.renderer = renderer;
    this.scene = scene;
    this.cameraController = new CameraController(camera, renderer.domElement);
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

    const objects = await this.adapter.loadRegion({
      center,
      geometry: options.geometry ?? 'map',
      radius: options.radius ?? 500,
    });
    for (const object of objects) {
      this.scene.add(object);
      this.worldObjects.push(object);
    }
    this.cameraController.frameObjects(objects);
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
    this.events.emit('debug-mode', { enabled });
  }

  setWorldAdapter(adapter: WorldAdapter): this {
    this.adapter = adapter;

    return this;
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

/** Free GPU geometry/material of an object tree. Textures are shared/cached — left intact. */
function disposeObject(object: Object3D): void {
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) {
      return;
    }
    mesh.geometry.dispose();
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((material) => material.dispose());
  });
}
