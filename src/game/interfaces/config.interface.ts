/** Bloom (glow on bright areas) tuning. */
export interface BloomConfig {
  /** Master toggle (off = the bloom pass is skipped). */
  enabled: boolean;
  /** Glow strength. */
  intensity: number;
  /** Luminance above which pixels bloom (lower = more of the scene glows). */
  threshold: number;
}

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

/** Procedural sky-dome cloud tuning. */
export interface CloudsConfig {
  /** Cloud cover 0 (clear) → 1 (overcast). */
  coverage: number;
  /** Cloud opacity over the sky (0 = off, skips the cloud shader branch). */
  opacity: number;
}

/** Top-level game configuration. Mutated in place so `PluginContext.config` stays live. */
export interface Config {
  camera: CameraConfig;
  controls: ControlsConfig;
  fog: FogConfig;
  fonts: FontsConfig;
  gameState: GameState;
  graphics: GraphicsConfig;
  hud: HudConfig;
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
  /** Seconds a weather change eases over (≤0 = instant switch). The current weather is a load param. */
  weatherTransitionSeconds: number;
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

/** Font family names per HUD widget (registered by the font loader before the scene). */
export interface FontsConfig {
  hud: { clock: string };
}

/** Whether the simulation is running (physics + control) or frozen. */
export type GameState = 'pause' | 'play';

/** Post-processing / graphics-effect toggles (cost-sensitive; off-able on weak machines). */
export interface GraphicsConfig {
  /** Bloom (bright-area glow) tuning. */
  bloom: BloomConfig;
  /** Procedural clouds on the sky dome. */
  clouds: CloudsConfig;
  /** Vehicle headlights (the occupied car's night beams). */
  headlights: HeadlightConfig;
  /** Night light sources (2d-effect coronas — street lamps etc.). */
  lights: LightsConfig;
  /** Night moon disc + glow. */
  moon: MoonConfig;
  /** Night ambient/atmosphere tuning (how dark + the moonlight tint). */
  night: NightConfig;
  /** Sun shadows (directional shadow map). */
  shadows: ShadowsConfig;
  /** Sky/sun god-rays shader tuning (shaft look). */
  sky: SkyConfig;
  /** Screen-space ambient occlusion (contact shadows in corners/under objects). */
  ssao: SsaoConfig;
  /** Procedural night stars on the sky dome. */
  stars: StarsConfig;
  /** Sun disc + god-rays source/toggle. */
  sun: SunConfig;
  /** ACES tone mapping. Off by default — the content is LDR (no HDR range), so it just washes it out. */
  toneMapping: boolean;
  /** Vehicle env-map reflections (preset-driven; see plan 030). */
  vehicleReflection: VehicleReflectionConfig;
  /** Water surface shader tuning (reflection + sun glint). */
  water: WaterConfig;
}

/** Vehicle headlight tuning (the occupied car's night beams; plan 033). */
export interface HeadlightConfig {
  /** Spot cone half-angle (radians) — wider = a bigger light pool on the road. */
  angle: number;
  /** Beam reach (world units) — how far the light pool extends ahead. */
  distance: number;
  /** Glow sprite size at each lamp (world units) — the bright flare on the headlight itself. */
  glow: number;
  /** Spotlight intensity (brightness/strength of the beam). */
  intensity: number;
}

/** HUD widget styling (the DOM overlay above the canvas; immune to post-processing). */
export interface HudConfig {
  clock: HudTextStyle;
}

/** Text style for a HUD widget: fill `color` + an outline (`borderColor`/`borderWidth` px). */
export interface HudTextStyle {
  borderColor: string;
  borderWidth: number;
  color: string;
  fontSize: number;
}

/** Night light-source (2d-effect corona) tuning. */
export interface LightsConfig {
  /** Master toggle (off = coronas never render). */
  enabled: boolean;
  /** Hour the lamps switch off in the morning (e.g. 6 = 06:00). */
  nightEndHour: number;
  /** Hour the lamps switch on in the evening (e.g. 20 = 20:00). */
  nightStartHour: number;
}

/** Diagnostic severity, low → high. The configured `showLogs` value is the floor that is emitted. */
export type LogLevel = 'debug' | 'error' | 'log' | 'warn';

/** Night moon tuning (a static sprite that fades in as night falls). */
export interface MoonConfig {
  /** Brightness multiplier for the (additive) moon sprite. */
  brightness: number;
  /** Height of the static moon above the horizon, in degrees. */
  elevationDeg: number;
  /** Moon disc size (world units). */
  size: number;
}

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

/** Night ambient / atmosphere tuning (the "dark night" look). */
export interface NightConfig {
  /** Distance (world units) past which lamp coronas fade out (a near-field cap over their per-lamp far-clip). */
  coronaDrawDistance: number;
  /** Night colour-grade strength (0 = off) — cool tint + desaturation + tinted shadow floor for night mood. */
  grade: number;
  /** Night skylight (hemisphere "moonlight from above") strength — top-down fill that gives objects form. */
  skylight: number;
  /** Night colour-grade tint (RGB 0–1, a cool moonlight blue) — used by the post-FX night grade. */
  tint: [number, number, number];
  /** Night-vertex-colour glow strength — how strongly the SA baked night lighting (lit windows / signs /
   *  road lamp-pools) self-illuminates at night. */
  windowGlow: number;
}

/** Sun shadow (directional shadow map) tuning. */
export interface ShadowsConfig {
  /** Master toggle (off = the sun stops casting → no shadow-map render, materials drop shadow code). */
  enabled: boolean;
}

/** God-rays shader tuning (pmndrs GodRaysEffect); higher = denser/brighter shafts. */
export interface SkyConfig {
  /** Density of the light rays along the sample march. */
  density: number;
  /** Constant attenuation coefficient (overall brightness). */
  exposure: number;
  /** Per-sample light weight. */
  weight: number;
}

/** Screen-space ambient occlusion (SSAO) tuning. */
export interface SsaoConfig {
  /** Master toggle (off = the normal pass + SSAO pass are skipped, zero cost). */
  enabled: boolean;
  /** Occlusion strength. */
  intensity: number;
  /** Sampling radius (relative to resolution; larger = wider, softer occlusion). */
  radius: number;
}

/** Procedural night-stars tuning. */
export interface StarsConfig {
  /** Master toggle (off = the dome shader skips the star branch). */
  enabled: boolean;
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

/** Sun disc + god-rays source tuning. */
export interface SunConfig {
  /** Volumetric light shafts from the sun (post-FX). */
  godrays: boolean;
  /** Base size of the god-rays light source (world units), independent of the visible disc — bigger = stronger shafts. */
  godraysSize: number;
  /** Visible sun disc base size (world units); the timecyc per-hour size scales this. */
  sunSize: number;
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

/** Vehicle env-map reflection tuning (plan 030). */
export interface VehicleReflectionConfig {
  /** Global reflection-intensity multiplier over the preset/DFF values. */
  intensity: number;
  /** Preset key into the reflection PRESETS registry; `'off'` (or unknown) = matte, no reflections. */
  preset: string;
}

/** Water surface shader tuning. */
export interface WaterConfig {
  /** How much to darken the deep (top-down) water tint, 0 (raw timecyc) → 1 (black). */
  darkness: number;
  /** Sun specular glint strength (sparkle along the sun direction). */
  glint: number;
  /** How much the sky horizon reflects at grazing angles (0–1). */
  reflection: number;
}
