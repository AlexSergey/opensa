import { type ReactElement, useEffect, useState } from 'react';

import type {
  BloomConfig,
  CameraConfig,
  City,
  CloudsConfig,
  EffectsConfig,
  Game,
  HeadlightConfig,
  LightsConfig,
  MoonConfig,
  NightConfig,
  ProcObjCategory,
  ProcObjConfig,
  ProcObjTypeConfig,
  ShadowsConfig,
  SkyConfig,
  SsaoConfig,
  StarsConfig,
  Vec3,
  VehicleReflectionConfig,
  WaterConfig,
  WorldLightConfig,
} from '../../game';

import { PRESETS } from '../../game/plugins/vehicle-reflection/presets';
import { GameClock } from '../../game/time/game-clock';
import { PLAYER_SPAWN } from '../locations';
import { styles } from './debug-styles';
import { MapInspector } from './map-inspector';

/** Quick time-of-day presets for the debugger (label → minutes since midnight). */
const TIME_PRESETS: [string, number][] = [
  ['00:00', 0],
  ['06:00', 360],
  ['12:00', 720],
  ['18:00', 1080],
  ['21:00', 1260],
];

/** Gameplay debug actions (GTA-specific) the F2 panel triggers; wired in canvas-host. */
export interface DebugActions {
  /** Current bloom tuning. */
  bloom(): BloomConfig;
  /** Smash the nearest breakable prop to the player (plan 045) — debugger trigger. No-op when none near. */
  breakNearest(): void;
  /** Current follow-camera tuning (distance / angle / responsiveness / zoom range). */
  camera(): CameraConfig;
  /** Live follow distance (includes wheel zoom) — polled for the "current" readout. */
  cameraDistance(): number;
  /** The city the player is currently in (Los Santos / San Fierro / Las Venturas / Countryside). */
  city(): City;
  /** Current cloud tuning. */
  clouds(): CloudsConfig;
  /** Current world 2dfx particle-effects tuning (plan 044). */
  effects(): EffectsConfig;
  /** Flip the occupied car (on wheels → roof, on roof → wheels). No-op on foot. */
  flipVehicle(): void;
  /** Current fog distance (world units to full fog). */
  fogDistance(): number;
  /** Current in-game time (minutes since midnight). */
  gameTime(): number;
  /** Whether the god-rays post-effect is on. */
  godrays(): boolean;
  /** Current god-rays light-source size (shaft strength). */
  godraysSize(): number;
  /** Current vehicle-headlight config (beam strength/reach/cone size + lamp glow). */
  headlights(): HeadlightConfig;
  /** Current night-lights (street-lamp coronas) config. */
  lights(): LightsConfig;
  /** Current night-moon config (size/glow/elevation). */
  moon(): MoonConfig;
  /** Current night ambient/atmosphere config (brightness/tint). */
  night(): NightConfig;
  /** Live player position (native Z-up). */
  playerCoords(): Vec3;
  /** Current procedural-clutter tuning (per category; plan 042). */
  procObj(): ProcObjConfig;
  /** Re-drop Tommy at his current spot (to unstick). */
  respawnPlayer(): void;
  /** Tune bloom (enabled/intensity/threshold). */
  setBloom(patch: Partial<BloomConfig>): void;
  /** Tune the follow camera (distance / angle / responsiveness / zoom range). */
  setCamera(patch: Partial<CameraConfig>): void;
  /** Tune clouds (coverage/opacity). */
  setClouds(patch: Partial<CloudsConfig>): void;
  /** Tune world 2dfx particle effects (enabled/drawDistance; plan 044). */
  setEffects(patch: Partial<EffectsConfig>): void;
  /** Set the fog distance (world units to full fog). */
  setFogDistance(distance: number): void;
  /** Set the in-game time (minutes since midnight). */
  setGameTime(minutes: number): void;
  /** Toggle the god-rays post-effect. */
  setGodrays(enabled: boolean): void;
  /** Set the god-rays light-source size (shaft strength). */
  setGodraysSize(size: number): void;
  /** Tune vehicle headlights (beam strength/reach/cone size + lamp glow). */
  setHeadlights(patch: Partial<HeadlightConfig>): void;
  /** Toggle night street-lamp lights (coronas). */
  setLights(patch: Partial<LightsConfig>): void;
  /** Tune the night moon (size/glow/elevation). */
  setMoon(patch: Partial<MoonConfig>): void;
  /** Tune night ambient/atmosphere (brightness/tint). */
  setNight(patch: Partial<NightConfig>): void;
  /** Tune one procedural-clutter category (enabled/drawDistance/density). */
  setProcObj(category: ProcObjCategory, patch: Partial<ProcObjTypeConfig>): void;
  /** Toggle sun shadows. */
  setShadows(patch: Partial<ShadowsConfig>): void;
  /** Tune the god-rays shader (density/exposure/weight). */
  setSky(patch: Partial<SkyConfig>): void;
  /** Tune SSAO (enabled/intensity/radius). */
  setSsao(patch: Partial<SsaoConfig>): void;
  /** Toggle night stars. */
  setStars(patch: Partial<StarsConfig>): void;
  /** Set the sun disc base size (world units). */
  setSunSize(size: number): void;
  /** Toggle ACES tone mapping. */
  setToneMapping(enabled: boolean): void;
  /** Tune vehicle reflections (preset/intensity). */
  setVehicleReflection(patch: Partial<VehicleReflectionConfig>): void;
  /** Tune the water shader (glint/reflection). */
  setWater(patch: Partial<WaterConfig>): void;
  /** Switch the active timecyc weather (index into WEATHER_NAMES). */
  setWeather(index: number): void;
  /** Tune the SA prelit world lighting (plan 038 day/night tints + shadow strength). */
  setWorldLight(patch: Partial<WorldLightConfig>): void;
  /** Whether sun shadows are on. */
  shadows(): ShadowsConfig;
  /** Current god-rays shader tuning. */
  sky(): SkyConfig;
  /** Spawn a car just in front of the player. */
  spawnVehicle(model: 'admiral' | 'camper'): Promise<void>;
  /** Current SSAO tuning. */
  ssao(): SsaoConfig;
  /** Whether night stars are on. */
  stars(): StarsConfig;
  /** Current sun disc base size (world units). */
  sunSize(): number;
  /** Teleport the player to a world position (native Z-up). */
  teleport(coords: Vec3): void;
  /** Teleport the player back to Ganton. */
  teleportToGanton(): void;
  /** Whether ACES tone mapping is on. */
  toneMapping(): boolean;
  /** Snap the map-inspector camera back to top-down (undo a right-drag orbit). */
  topDownView(): void;
  /** Current vehicle-reflection tuning (preset + intensity). */
  vehicleReflection(): VehicleReflectionConfig;
  /** Current water shader tuning. */
  water(): WaterConfig;
  /** Active timecyc weather index. */
  weather(): number;
  /** Selectable weathers (index + label), rain/storm excluded. */
  weatherList(): readonly { index: number; label: string }[];
  /** Current SA prelit world-lighting calibration. */
  worldLight(): WorldLightConfig;
}

/** Reflection preset cycle order for the debug selector (Off + the registry keys). */
const REFLECTION_PRESETS = ['off', ...Object.keys(PRESETS)];

/** Display label per city token. */
const CITY_LABEL: Record<City, string> = {
  COUNTRYSIDE: 'Countryside',
  DESERT: 'Desert (Bone County)',
  LA: 'Los Santos',
  SF: 'San Fierro',
  VEGAS: 'Las Venturas',
};

type Screen =
  | 'atmosphere'
  | 'camera'
  | 'graphics'
  | 'map'
  | 'player'
  | 'position'
  | 'procobj'
  | 'root'
  | 'time'
  | 'vehicles'
  | 'weather';

const MENU: { label: string; screen: Screen }[] = [
  { label: 'Player', screen: 'player' },
  { label: 'Vehicles', screen: 'vehicles' },
  { label: 'Time', screen: 'time' },
  { label: 'Atmosphere', screen: 'atmosphere' },
  { label: 'Camera', screen: 'camera' },
  { label: 'Graphics', screen: 'graphics' },
  { label: 'ProcObj', screen: 'procobj' },
  { label: 'Weather', screen: 'weather' },
  { label: 'Position', screen: 'position' },
  { label: 'Map', screen: 'map' },
];

/** ProcObj screen rows — display order for the clutter categories (plan 042). */
const PROCOBJ_CATEGORIES: readonly ProcObjCategory[] = [
  'grass',
  'flowers',
  'bushes',
  'cacti',
  'trees',
  'rocks',
  'underwater',
];

/** Graphics-screen block for the world 2dfx particle effects (plan 044): master toggle + the
 *  draw distance that replaces the systems' authored CULLDIST. */
function WorldEffectsControls(props: {
  effects: EffectsConfig;
  onPatch: (patch: Partial<EffectsConfig>) => void;
}): ReactElement {
  const { effects, onPatch } = props;

  return (
    <>
      <label style={styles.label}>
        <input
          checked={effects.enabled}
          onChange={() => onPatch({ enabled: !effects.enabled })}
          style={styles.radio}
          type="checkbox"
        />
        <span style={effects.enabled ? styles.optionActive : styles.option}>World effects</span>
      </label>
      <div style={styles.groupLabel}>EFFECTS DISTANCE: {effects.drawDistance.toFixed(0)}</div>
      <input
        max={300}
        min={10}
        onChange={(e) => onPatch({ drawDistance: Number(e.target.value) })}
        step={10}
        type="range"
        value={effects.drawDistance}
      />
    </>
  );
}

/** Quick teleport destinations (native GTA Z-up world coords). */
const TELEPORTS: { coords: Vec3; label: string }[] = [
  { coords: PLAYER_SPAWN, label: 'LS - Ganton' },
  { coords: [1481.0, -1744.0, 13.5], label: 'LS - Downtown' },
  { coords: [2860.28, -1887.01, 10.86], label: 'LS - Long Beach' },
  { coords: [342.0, -1803.0, 4.8], label: 'LS - Santa Maria Beach' },
  { coords: [2020.0, 1007.0, 10.86], label: 'LV - City Center' },
  { coords: [2031.09, 1539.7, 10.74], label: 'LV - Pirate' },
  { coords: [2019.8, 1007.7, 10.86], label: 'LV - Four Dragons' },
  { coords: [1697.0, 1447.0, 10.86], label: 'LV - Airport' },
  { coords: [-1905.0, 277.0, 41.0], label: 'SF - Doherty' },
  { coords: [-1988.0, 138.0, 27.5], label: 'SF - City Center' },
  { coords: [-1420.0, -287.0, 14.1], label: 'SF - Airport' },
  { coords: [-1045.0, -1620.0, 76.4], label: "Country - Truth's Farm" },
  { coords: [1139.0, -1490.0, 18.5], label: 'LS - Escalators' },
];

/**
 * In-game debugger (toggle with **F2**). A multi-level menu of gameplay debug
 * actions; opening it has **no** effect on the simulation — only the Map screen's
 * "Activate Map Viewer" enters the map-viewer mode (and leaving it exits cleanly).
 */
export function DebugOverlay({ actions, game }: { actions: DebugActions; game: Game }): null | ReactElement {
  const [visible, setVisible] = useState(false);
  const [screen, setScreen] = useState<Screen>('root');
  const [showCoords, setShowCoords] = useState(false);
  const [coords, setCoords] = useState<Vec3>([0, 0, 0]);
  const [city, setCity] = useState<City>(() => actions.city());
  const [mapActive, setMapActive] = useState(false);
  const [fog, setFog] = useState(() => actions.fogDistance());
  const [time, setTime] = useState(() => actions.gameTime());
  const [godrays, setGodrays] = useState(() => actions.godrays());
  const [godraysSize, setGodraysSize] = useState(() => actions.godraysSize());
  const [bloom, setBloom] = useState<BloomConfig>(() => actions.bloom());
  const [camera, setCamera] = useState<CameraConfig>(() => actions.camera());
  const [cameraZoom, setCameraZoom] = useState(() => actions.cameraDistance());
  const [clouds, setClouds] = useState<CloudsConfig>(() => actions.clouds());
  const [toneMapping, setToneMapping] = useState(() => actions.toneMapping());
  const [water, setWater] = useState<WaterConfig>(() => actions.water());
  const [reflectionCfg, setReflectionCfg] = useState<VehicleReflectionConfig>(() => actions.vehicleReflection());
  const [ssao, setSsao] = useState<SsaoConfig>(() => actions.ssao());
  const [shadows, setShadows] = useState<ShadowsConfig>(() => actions.shadows());
  const [stars, setStars] = useState<StarsConfig>(() => actions.stars());
  const [lights, setLights] = useState<LightsConfig>(() => actions.lights());
  const [headlights, setHeadlights] = useState<HeadlightConfig>(() => actions.headlights());
  const [moon, setMoon] = useState<MoonConfig>(() => actions.moon());
  const [night, setNight] = useState<NightConfig>(() => actions.night());
  const [worldLight, setWorldLight] = useState<WorldLightConfig>(() => actions.worldLight());
  const [procObj, setProcObj] = useState<ProcObjConfig>(() => actions.procObj());
  const [effects, setEffects] = useState<EffectsConfig>(() => actions.effects());
  const [sky, setSky] = useState<SkyConfig>(() => actions.sky());
  const [sunSize, setSunSize] = useState(() => actions.sunSize());
  const [weather, setWeather] = useState(() => actions.weather());

  // F2 toggles the panel; closing resets navigation (so the map viewer is left and we reopen at root).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'F2') {
        e.preventDefault();
        if (visible) {
          resetTo('root');
        }
        setVisible((previous) => !previous);
      }
    }
    window.addEventListener('keydown', handleKeyDown);

    return (): void => window.removeEventListener('keydown', handleKeyDown);
  }, [visible]);

  // Keep the shown coords live while the Position screen displays them.
  useEffect(() => {
    if (!visible || screen !== 'position' || !showCoords) {
      return;
    }
    const id = setInterval(() => setCoords(actions.playerCoords()), 200);

    return (): void => clearInterval(id);
  }, [actions, visible, screen, showCoords]);

  // Keep the city label live — updates on city crossings (event-driven, no polling).
  useEffect(() => game.events.on('city', ({ city: next }) => setCity(next)), [game]);

  // Keep the live clock label ticking while the Time screen is open.
  useEffect(() => {
    if (!visible || screen !== 'time') {
      return;
    }
    const id = setInterval(() => setTime(actions.gameTime()), 500);

    return (): void => clearInterval(id);
  }, [actions, visible, screen]);

  // Keep the live follow-distance (wheel zoom) readout updating while the Camera screen is open.
  useEffect(() => {
    if (!visible || screen !== 'camera') {
      return;
    }
    const id = setInterval(() => setCameraZoom(actions.cameraDistance()), 200);

    return (): void => clearInterval(id);
  }, [actions, visible, screen]);

  function resetTo(next: Screen): void {
    setScreen(next);
    setShowCoords(false);
    setMapActive(false);
  }

  if (!visible) {
    return null;
  }

  return (
    <div style={styles.panel}>
      <button
        onClick={() => {
          resetTo('root');
          setVisible(false);
        }}
        style={styles.close}
        type="button"
      >
        ×
      </button>
      <div style={styles.title}>DEBUG</div>

      {screen === 'root' ? (
        <div style={styles.group}>
          {MENU.map((item) => (
            <button key={item.screen} onClick={() => resetTo(item.screen)} style={styles.menuButton} type="button">
              {item.label} <span>›</span>
            </button>
          ))}
        </div>
      ) : (
        <>
          <button onClick={() => resetTo('root')} style={styles.backButton} type="button">
            ‹ back
          </button>

          {screen === 'player' && (
            <div style={styles.group}>
              <button onClick={() => actions.respawnPlayer()} style={styles.actionButton} type="button">
                Respawn
              </button>
              <button onClick={() => actions.teleportToGanton()} style={styles.actionButton} type="button">
                To Ganton
              </button>
              <button onClick={() => actions.breakNearest()} style={styles.actionButton} type="button">
                Break nearest prop
              </button>
            </div>
          )}

          {screen === 'vehicles' && (
            <div style={styles.group}>
              <button onClick={() => void actions.spawnVehicle('admiral')} style={styles.actionButton} type="button">
                Admiral Spawn
              </button>
              <button onClick={() => void actions.spawnVehicle('camper')} style={styles.actionButton} type="button">
                Camper Spawn
              </button>
              <button onClick={() => actions.flipVehicle()} style={styles.actionButton} type="button">
                Flip vehicle
              </button>
            </div>
          )}

          {screen === 'position' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>CITY: {CITY_LABEL[city]}</div>
              <button
                onClick={() => {
                  setCoords(actions.playerCoords());
                  setShowCoords(true);
                }}
                style={styles.actionButton}
                type="button"
              >
                Show coords
              </button>
              {showCoords && (
                <>
                  <div style={styles.info}>{coords.map((n) => n.toFixed(2)).join(', ')}</div>
                  <button
                    onClick={() => void navigator.clipboard.writeText(coords.map((n) => n.toFixed(2)).join(', '))}
                    style={styles.actionButton}
                    type="button"
                  >
                    Copy Coords
                  </button>
                </>
              )}

              <div style={styles.groupLabel}>TELEPORT</div>
              {TELEPORTS.map((t) => (
                <button
                  key={t.label}
                  onClick={() => actions.teleport(t.coords)}
                  style={styles.actionButton}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {screen === 'time' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>TIME: {GameClock.format(time)}</div>
              <div style={styles.presetRow}>
                {TIME_PRESETS.map(([label, minutes]) => (
                  <button
                    key={label}
                    onClick={() => {
                      setTime(minutes);
                      actions.setGameTime(minutes);
                    }}
                    style={styles.actionButton}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>
              <input
                max={1439}
                min={0}
                onChange={(e) => {
                  const minutes = Number(e.target.value);
                  setTime(minutes);
                  actions.setGameTime(minutes);
                }}
                step={15}
                type="range"
                value={time}
              />
            </div>
          )}

          {screen === 'atmosphere' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>NIGHT LIGHTING FADE (windows + tonemap)</div>
              {(
                [
                  ['duskStart', 'DUSK START'],
                  ['duskEnd', 'DUSK END'],
                  ['dawnStart', 'DAWN START'],
                  ['dawnEnd', 'DAWN END'],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {night.litFade[key].toFixed(1)}h
                  </div>
                  <input
                    max={24}
                    min={0}
                    onChange={(e) => {
                      const litFade = { ...night.litFade, [key]: Number(e.target.value) };
                      setNight((prev) => ({ ...prev, litFade }));
                      actions.setNight({ litFade });
                    }}
                    step={0.5}
                    type="range"
                    value={night.litFade[key]}
                  />
                </div>
              ))}
              <div style={styles.groupLabel}>DYNAMIC NIGHT FILL (player + cars)</div>
              {(
                [
                  ['strength', 'NIGHT FILL', 2],
                  ['rim', 'NIGHT FILL RIM', 2],
                ] as const
              ).map(([key, label, max]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {night.dynamicObjectsFill[key].toFixed(2)}
                  </div>
                  <input
                    max={max}
                    min={0}
                    onChange={(e) => {
                      const dynamicObjectsFill = { ...night.dynamicObjectsFill, [key]: Number(e.target.value) };
                      setNight((prev) => ({ ...prev, dynamicObjectsFill }));
                      actions.setNight({ dynamicObjectsFill });
                    }}
                    step={0.05}
                    type="range"
                    value={night.dynamicObjectsFill[key]}
                  />
                </div>
              ))}
              <div style={styles.groupLabel}>FOG: {fog} m</div>
              <input
                max={2000}
                min={10}
                onChange={(e) => {
                  const distance = Number(e.target.value);
                  setFog(distance);
                  actions.setFogDistance(distance);
                }}
                step={10}
                type="range"
                value={fog}
              />
              <div style={styles.groupLabel}>CLOUD COVER: {clouds.coverage.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const coverage = Number(e.target.value);
                  setClouds((prev) => ({ ...prev, coverage }));
                  actions.setClouds({ coverage });
                }}
                step={0.01}
                type="range"
                value={clouds.coverage}
              />
              <div style={styles.groupLabel}>CLOUD OPACITY: {clouds.opacity.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const opacity = Number(e.target.value);
                  setClouds((prev) => ({ ...prev, opacity }));
                  actions.setClouds({ opacity });
                }}
                step={0.01}
                type="range"
                value={clouds.opacity}
              />
              <label style={styles.label}>
                <input
                  checked={stars.enabled}
                  onChange={() => {
                    const enabled = !stars.enabled;
                    setStars({ enabled });
                    actions.setStars({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={stars.enabled ? styles.optionActive : styles.option}>Night stars</span>
              </label>
              <label style={styles.label}>
                <input
                  checked={lights.enabled}
                  onChange={() => {
                    const enabled = !lights.enabled;
                    setLights((prev) => ({ ...prev, enabled }));
                    actions.setLights({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={lights.enabled ? styles.optionActive : styles.option}>Night lights (lamps)</span>
              </label>
              <div style={styles.groupLabel}>MOON SIZE: {moon.size.toFixed(0)}</div>
              <input
                max={400}
                min={40}
                onChange={(e) => {
                  const size = Number(e.target.value);
                  setMoon((prev) => ({ ...prev, size }));
                  actions.setMoon({ size });
                }}
                step={5}
                type="range"
                value={moon.size}
              />
              <div style={styles.groupLabel}>MOON ELEVATION: {moon.elevationDeg.toFixed(0)}°</div>
              <input
                max={80}
                min={2}
                onChange={(e) => {
                  const elevationDeg = Number(e.target.value);
                  setMoon((prev) => ({ ...prev, elevationDeg }));
                  actions.setMoon({ elevationDeg });
                }}
                step={1}
                type="range"
                value={moon.elevationDeg}
              />
              <div style={styles.groupLabel}>MOON BRIGHTNESS: {moon.brightness.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const brightness = Number(e.target.value);
                  setMoon((prev) => ({ ...prev, brightness }));
                  actions.setMoon({ brightness });
                }}
                step={0.05}
                type="range"
                value={moon.brightness}
              />
              <div style={styles.groupLabel}>CORONA DISTANCE: {night.coronaDrawDistance.toFixed(0)}</div>
              <input
                max={400}
                min={20}
                onChange={(e) => {
                  const coronaDrawDistance = Number(e.target.value);
                  setNight((prev) => ({ ...prev, coronaDrawDistance }));
                  actions.setNight({ coronaDrawDistance });
                }}
                step={5}
                type="range"
                value={night.coronaDrawDistance}
              />
              <div style={styles.groupLabel}>NIGHT SKYLIGHT: {night.skylight.toFixed(2)}</div>
              <input
                max={2}
                min={0}
                onChange={(e) => {
                  const skylight = Number(e.target.value);
                  setNight((prev) => ({ ...prev, skylight }));
                  actions.setNight({ skylight });
                }}
                step={0.05}
                type="range"
                value={night.skylight}
              />
              <div style={styles.groupLabel}>NIGHT WINDOW GLOW: {night.windowGlow.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const windowGlow = Number(e.target.value);
                  setNight((prev) => ({ ...prev, windowGlow }));
                  actions.setNight({ windowGlow });
                }}
                step={0.05}
                type="range"
                value={night.windowGlow}
              />
              <div style={styles.groupLabel}>WORLD LIGHT (SA prelit map — plan 038)</div>
              {(
                [
                  ['dayBrightness', 'WORLD DAY', 0.3, 1.2, 0.05],
                  ['duskBrightness', 'WORLD DUSK', 0.1, 1, 0.05],
                  ['nightPrelitBrightness', 'WORLD NIGHT PRELIT', 0.2, 1.5, 0.05],
                  ['lodNightAmbScale', 'LOD NIGHT AMB', 0.2, 4, 0.1],
                  ['shadowStrength', 'WORLD SHADOW', 0, 1, 0.05],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {worldLight[key].toFixed(2)}
                  </div>
                  <input
                    max={max}
                    min={min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setWorldLight((prev) => ({ ...prev, [key]: value }));
                      actions.setWorldLight({ [key]: value });
                    }}
                    step={step}
                    type="range"
                    value={worldLight[key]}
                  />
                </div>
              ))}
            </div>
          )}

          {screen === 'procobj' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>PROCEDURAL CLUTTER (procobj.dat — plan 042)</div>
              {PROCOBJ_CATEGORIES.map((category) => {
                const patch = (value: Partial<ProcObjTypeConfig>): void => {
                  setProcObj((prev) => ({ ...prev, [category]: { ...prev[category], ...value } }));
                  actions.setProcObj(category, value);
                };

                return (
                  <div key={category}>
                    <label style={styles.label}>
                      <input
                        checked={procObj[category].enabled}
                        onChange={() => patch({ enabled: !procObj[category].enabled })}
                        style={styles.radio}
                        type="checkbox"
                      />
                      <span style={procObj[category].enabled ? styles.optionActive : styles.option}>
                        {category.toUpperCase()}
                      </span>
                    </label>
                    <div style={styles.groupLabel}>DRAW DISTANCE: {procObj[category].drawDistance.toFixed(0)}</div>
                    <input
                      max={300}
                      min={10}
                      onChange={(e) => patch({ drawDistance: Number(e.target.value) })}
                      step={10}
                      type="range"
                      value={procObj[category].drawDistance}
                    />
                    <div style={styles.groupLabel}>DENSITY: {procObj[category].density.toFixed(1)}</div>
                    <input
                      max={3}
                      min={0}
                      onChange={(e) => patch({ density: Number(e.target.value) })}
                      step={0.1}
                      type="range"
                      value={procObj[category].density}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {screen === 'camera' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>FOLLOW CAMERA (mouse looks; auto-trails when you change direction)</div>
              <div style={styles.groupLabel}>CURRENT ZOOM: {cameraZoom.toFixed(1)}</div>
              {(
                [
                  ['followDistance', 'DISTANCE', 4, 80, 1],
                  ['followZoomMin', 'MIN ZOOM', 4, 40, 1],
                  ['followZoomMax', 'MAX ZOOM', 6, 80, 1],
                  ['followHeight', 'HEIGHT', 0, 4, 0.1],
                  ['followPolar', 'ANGLE', 0.2, 1.5, 0.05],
                  ['followLerp', 'RESPONSE', 0.5, 12, 0.5],
                  ['followMinPolar', 'MIN ANGLE', 0.05, 1.5, 0.05],
                  ['followMaxPolar', 'MAX ANGLE', 0.5, 1.55, 0.05],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {label}: {camera[key].toFixed(2)}
                  </div>
                  <input
                    max={max}
                    min={min}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setCamera((prev) => ({ ...prev, [key]: value }));
                      actions.setCamera({ [key]: value });
                    }}
                    step={step}
                    type="range"
                    value={camera[key]}
                  />
                </div>
              ))}
              <label style={styles.label}>
                <input
                  checked={camera.followZoom}
                  onChange={() => {
                    const followZoom = !camera.followZoom;
                    setCamera((prev) => ({ ...prev, followZoom }));
                    actions.setCamera({ followZoom });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={camera.followZoom ? styles.optionActive : styles.option}>Wheel zoom</span>
              </label>
            </div>
          )}

          {screen === 'graphics' && (
            <div style={styles.group}>
              <div style={styles.groupLabel}>GRAPHICS</div>
              <label style={styles.label}>
                <input
                  checked={godrays}
                  onChange={() => {
                    const next = !godrays;
                    setGodrays(next);
                    actions.setGodrays(next);
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={godrays ? styles.optionActive : styles.option}>God rays</span>
              </label>
              <div style={styles.groupLabel}>RAYS SIZE: {godraysSize}</div>
              <input
                max={120}
                min={5}
                onChange={(e) => {
                  const size = Number(e.target.value);
                  setGodraysSize(size);
                  actions.setGodraysSize(size);
                }}
                step={1}
                type="range"
                value={godraysSize}
              />
              <div style={styles.groupLabel}>SUN SIZE: {sunSize}</div>
              <input
                max={120}
                min={5}
                onChange={(e) => {
                  const size = Number(e.target.value);
                  setSunSize(size);
                  actions.setSunSize(size);
                }}
                step={1}
                type="range"
                value={sunSize}
              />
              {(['density', 'exposure', 'weight'] as const).map((key) => (
                <div key={key}>
                  <div style={styles.groupLabel}>
                    {key.toUpperCase()}: {sky[key].toFixed(2)}
                  </div>
                  <input
                    max={1}
                    min={0}
                    onChange={(e) => {
                      const value = Number(e.target.value);
                      setSky((prev) => ({ ...prev, [key]: value }));
                      actions.setSky({ [key]: value });
                    }}
                    step={0.01}
                    type="range"
                    value={sky[key]}
                  />
                </div>
              ))}
              <label style={styles.label}>
                <input
                  checked={bloom.enabled}
                  onChange={() => {
                    const enabled = !bloom.enabled;
                    setBloom((prev) => ({ ...prev, enabled }));
                    actions.setBloom({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={bloom.enabled ? styles.optionActive : styles.option}>Bloom</span>
              </label>
              <div style={styles.groupLabel}>INTENSITY: {bloom.intensity.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setBloom((prev) => ({ ...prev, intensity }));
                  actions.setBloom({ intensity });
                }}
                step={0.05}
                type="range"
                value={bloom.intensity}
              />
              <div style={styles.groupLabel}>THRESHOLD: {bloom.threshold.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const threshold = Number(e.target.value);
                  setBloom((prev) => ({ ...prev, threshold }));
                  actions.setBloom({ threshold });
                }}
                step={0.01}
                type="range"
                value={bloom.threshold}
              />
              <label style={styles.label}>
                <input
                  checked={ssao.enabled}
                  onChange={() => {
                    const enabled = !ssao.enabled;
                    setSsao((prev) => ({ ...prev, enabled }));
                    actions.setSsao({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={ssao.enabled ? styles.optionActive : styles.option}>SSAO</span>
              </label>
              <div style={styles.groupLabel}>AO INTENSITY: {ssao.intensity.toFixed(2)}</div>
              <input
                max={4}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setSsao((prev) => ({ ...prev, intensity }));
                  actions.setSsao({ intensity });
                }}
                step={0.1}
                type="range"
                value={ssao.intensity}
              />
              <div style={styles.groupLabel}>AO RADIUS: {ssao.radius.toFixed(2)}</div>
              <input
                max={1}
                min={0.01}
                onChange={(e) => {
                  const radius = Number(e.target.value);
                  setSsao((prev) => ({ ...prev, radius }));
                  actions.setSsao({ radius });
                }}
                step={0.01}
                type="range"
                value={ssao.radius}
              />
              <label style={styles.label}>
                <input
                  checked={shadows.enabled}
                  onChange={() => {
                    const enabled = !shadows.enabled;
                    setShadows({ enabled });
                    actions.setShadows({ enabled });
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={shadows.enabled ? styles.optionActive : styles.option}>Sun shadows</span>
              </label>
              <WorldEffectsControls
                effects={effects}
                onPatch={(patch) => {
                  setEffects((prev) => ({ ...prev, ...patch }));
                  actions.setEffects(patch);
                }}
              />
              <div style={styles.groupLabel}>HEADLIGHT POWER: {headlights.intensity.toFixed(1)}</div>
              <input
                max={30}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setHeadlights((prev) => ({ ...prev, intensity }));
                  actions.setHeadlights({ intensity });
                }}
                step={0.5}
                type="range"
                value={headlights.intensity}
              />
              <div style={styles.groupLabel}>HEADLIGHT DISTANCE: {headlights.distance.toFixed(0)}</div>
              <input
                max={80}
                min={5}
                onChange={(e) => {
                  const distance = Number(e.target.value);
                  setHeadlights((prev) => ({ ...prev, distance }));
                  actions.setHeadlights({ distance });
                }}
                step={1}
                type="range"
                value={headlights.distance}
              />
              <div style={styles.groupLabel}>HEADLIGHT CONE: {headlights.angle.toFixed(2)}</div>
              <input
                max={1}
                min={0.1}
                onChange={(e) => {
                  const angle = Number(e.target.value);
                  setHeadlights((prev) => ({ ...prev, angle }));
                  actions.setHeadlights({ angle });
                }}
                step={0.02}
                type="range"
                value={headlights.angle}
              />
              <div style={styles.groupLabel}>HEADLIGHT GLOW: {headlights.glow.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const glow = Number(e.target.value);
                  setHeadlights((prev) => ({ ...prev, glow }));
                  actions.setHeadlights({ glow });
                }}
                step={0.02}
                type="range"
                value={headlights.glow}
              />
              <label style={styles.label}>
                <input
                  checked={toneMapping}
                  onChange={() => {
                    const next = !toneMapping;
                    setToneMapping(next);
                    actions.setToneMapping(next);
                  }}
                  style={styles.radio}
                  type="checkbox"
                />
                <span style={toneMapping ? styles.optionActive : styles.option}>Tone map (ACES)</span>
              </label>
              <div style={styles.groupLabel}>WATER GLINT: {water.glint.toFixed(2)}</div>
              <input
                max={5}
                min={0}
                onChange={(e) => {
                  const glint = Number(e.target.value);
                  setWater((prev) => ({ ...prev, glint }));
                  actions.setWater({ glint });
                }}
                step={0.1}
                type="range"
                value={water.glint}
              />
              <div style={styles.groupLabel}>WATER REFLECTION: {water.reflection.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const reflection = Number(e.target.value);
                  setWater((prev) => ({ ...prev, reflection }));
                  actions.setWater({ reflection });
                }}
                step={0.01}
                type="range"
                value={water.reflection}
              />
              <div style={styles.groupLabel}>WATER DARKNESS: {water.darkness.toFixed(2)}</div>
              <input
                max={1}
                min={0}
                onChange={(e) => {
                  const darkness = Number(e.target.value);
                  setWater((prev) => ({ ...prev, darkness }));
                  actions.setWater({ darkness });
                }}
                step={0.01}
                type="range"
                value={water.darkness}
              />
              <button
                onClick={() => {
                  const next =
                    REFLECTION_PRESETS[
                      (REFLECTION_PRESETS.indexOf(reflectionCfg.preset) + 1) % REFLECTION_PRESETS.length
                    ];
                  setReflectionCfg((prev) => ({ ...prev, preset: next }));
                  actions.setVehicleReflection({ preset: next });
                }}
                style={styles.actionButton}
                type="button"
              >
                Car reflect: {PRESETS[reflectionCfg.preset]?.label ?? 'Off'}
              </button>
              <div style={styles.groupLabel}>REFLECT INTENSITY: {reflectionCfg.intensity.toFixed(2)}</div>
              <input
                max={3}
                min={0}
                onChange={(e) => {
                  const intensity = Number(e.target.value);
                  setReflectionCfg((prev) => ({ ...prev, intensity }));
                  actions.setVehicleReflection({ intensity });
                }}
                step={0.05}
                type="range"
                value={reflectionCfg.intensity}
              />
            </div>
          )}

          {screen === 'weather' && (
            <div style={styles.group}>
              {actions.weatherList().map((w) => (
                <button
                  key={w.index}
                  onClick={() => {
                    setWeather(w.index);
                    actions.setWeather(w.index);
                  }}
                  style={styles.actionButton}
                  type="button"
                >
                  {weather === w.index ? '● ' : ''}
                  {w.label}
                </button>
              ))}
            </div>
          )}

          {screen === 'map' && (
            <div style={styles.group}>
              <button onClick={() => setMapActive((previous) => !previous)} style={styles.actionButton} type="button">
                {mapActive ? 'Deactivate Map Viewer' : 'Activate Map Viewer'}
              </button>
              {mapActive && (
                <button onClick={() => actions.topDownView()} style={styles.actionButton} type="button">
                  Top (reset view)
                </button>
              )}
              {mapActive && <MapInspector game={game} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
