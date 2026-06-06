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
  debugMode: boolean;
  gameState: GameState;
  movement: MovementConfig;
  /** Overlay collision (COL) wireframes on the current region (debug). */
  showCollision: boolean;
  staticUrl: string;
  streaming: StreamingConfig;
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

/** Whether the simulation is running (physics + control) or frozen. */
export type GameState = 'pause' | 'play';

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
