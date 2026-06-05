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
  /** Overlay collision (COL) wireframes on the current region (debug). */
  showCollision: boolean;
  staticUrl: string;
}

/** Remappable keyboard bindings; values are `KeyboardEvent.code`. */
export interface ControlsConfig {
  back: string;
  forward: string;
  jump: string;
  left: string;
  right: string;
}

/** Whether the simulation is running (physics + control) or frozen. */
export type GameState = 'pause' | 'play';
