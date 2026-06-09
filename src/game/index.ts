export type { System } from './core/system';

export { EventBus } from './events/event-bus';
export type { GameEvents } from './events/events.global';

// Public API of the framework-agnostic game engine.
export { Game } from './game';
export type { ColliderBox, ColliderShape, ColliderSphere, ModelColliders } from './interfaces/collider.interface';
export type {
  BloomConfig,
  CloudsConfig,
  Config,
  LightsConfig,
  MoonConfig,
  NightConfig,
  ShadowsConfig,
  SkyConfig,
  SsaoConfig,
  StarsConfig,
  VehicleReflectionConfig,
  WaterConfig,
} from './interfaces/config.interface';

export type { RegionRequest, Vec3, WorldAdapter, WorldObjectInfo } from './interfaces/world-adapter.interface';

export { AmbientLightPlugin } from './plugins/ambient-light.plugin';
export { DirectionalLightPlugin } from './plugins/directional-light.plugin';
export type { Plugin, PluginContext, RenderPass, RenderPipeline } from './plugins/plugin';

export type { CellCoord } from './streaming/grid';
export { StreamingSystem } from './streaming/streaming.system';
