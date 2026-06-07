/** Follow/play camera tuning (the debug overview camera is fixed top-down). */
export interface CameraConfig {
  /** Distance from the player in follow mode (GTA/world units). */
  followDistance: number;
  /** Lowest the camera may drop toward the horizon (radians from straight up); keeps it above the floor. */
  followMaxPolar: number;
  /** Highest the camera may rise toward straight-down (radians from straight up). */
  followMinPolar: number;
  /** Allow wheel zoom in follow/play mode. */
  followZoom: boolean;
}

/** Top-level game configuration. Mutated in place so `PluginContext.config` stays live. */
export interface Config {
  camera: CameraConfig;
  controls: ControlsConfig;
  fog: FogConfig;
  gameState: GameState;
  /** Map-viewer mode: free-fly camera + manual cell render + click-to-pick (debug map inspector). */
  mapViewer: boolean;
  movement: MovementConfig;
  /** Overlay collision (COL) wireframes on the current region (debug). */
  showCollision: boolean;
  /** Diagnostic log floor: `false` = silent (default); otherwise emit `'log'` events at this level or higher. */
  showLogs: false | LogLevel;
  staticUrl: string;
  streaming: StreamingConfig;
  time: TimeConfig;
  vehicle: VehicleConfig;
}

/** Remappable keyboard bindings; values are `KeyboardEvent.code`. */
export interface ControlsConfig {
  back: string;
  forward: string;
  jump: string;
  left: string;
  right: string;
  /** Hold to run (faster); walk otherwise. Optional. */
  run?: string;
}

/** Distance fog tuning. */
export interface FogConfig {
  /** Distance (world units) at which the world is fully fogged (the horizon); fog ramps in before it. */
  distance: number;
}

/** Whether the simulation is running (physics + control) or frozen. */
export type GameState = 'pause' | 'play';

/** Diagnostic severity, low → high. The configured `showLogs` value is the floor that is emitted. */
export type LogLevel = 'debug' | 'error' | 'log' | 'warn';

/** Player movement tuning (world units/second; rates in units/s²). */
export interface MovementConfig {
  /** Horizontal acceleration toward the input target (ramp-up + turn momentum). */
  accel: number;
  /** Fraction (0..1) of accel/deceleration applied while airborne (air control). */
  airControl: number;
  /** Horizontal deceleration toward rest when there is no input. */
  deceleration: number;
  /** Upward launch velocity when jumping. */
  jumpSpeed: number;
  /** Planar speed while holding the run key. */
  runSpeed: number;
  /** Planar speed when walking (default). */
  walkSpeed: number;
}

/** World streaming / LOD tuning (sectioned grid render). */
export interface StreamingConfig {
  /** Grid cell edge in world units (must match the adapter's grid). */
  cellSize: number;
  /** Static collision is streamed within this distance of the view (small + a margin). */
  collisionDrawDistance: number;
  /** Full (HD) models are streamed within this distance of the view. */
  hdDrawDistance: number;
  /** LODs are streamed within this distance (beyond the HD ring). */
  lodDrawDistance: number;
}

/** Game-clock tuning. */
export interface TimeConfig {
  /** Real seconds per in-game minute (e.g. 1.5 → a full day is 36 real minutes). */
  secondsPerGameMinute: number;
}

/** Vehicle distance-LOD thresholds (world units from the player view). */
export interface VehicleConfig {
  /** Within this distance the full HD model is shown. */
  hdDistance: number;
  /** Between `hdDistance` and this the low-detail `_vlo` is shown; beyond it the car is culled. */
  lodDistance: number;
  /** Beyond this the car is unloaded from memory; it respawns when back within `lodDistance`. */
  unloadDistance: number;
}
