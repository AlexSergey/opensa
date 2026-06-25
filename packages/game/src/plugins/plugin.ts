import type { PerspectiveCamera, Scene, WebGLRenderer } from 'three';

import type { EventBus } from '../events/event-bus';
import type { GameEvents } from '../events/events.global';
import type { Config } from '../interfaces/config.interface';

/**
 * Extension unit for the engine (lighting now; post-processing / shaders later).
 * Class-based so plugins can hold state and a clear lifecycle.
 */
export interface Plugin {
  configChanged?(config: Readonly<Config>): void;
  dispose?(): void;
  install(context: PluginContext): Promise<void> | void;
  readonly name: string;
  resize?(width: number, height: number): void;
  update?(context: PluginContext): void;
}

/** Everything a plugin is handed at install / per frame. */
export interface PluginContext {
  readonly camera: PerspectiveCamera;
  readonly clock: { delta: number; elapsed: number };
  readonly config: Readonly<Config>;
  readonly events: EventBus<GameEvents>;
  readonly pipeline: RenderPipeline;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
}

/** A single rendering step (e.g. an EffectComposer pass) plugins can contribute. */
export interface RenderPass {
  render(): void;
}

/** Owns how the frame is presented; plugins add passes for custom shaders / post-fx. */
export interface RenderPipeline {
  addPass(pass: RenderPass): void;
  removePass(pass: RenderPass): void;
  render(): void;
}
