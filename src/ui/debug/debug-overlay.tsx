import { type ReactElement, useEffect, useState } from 'react';

import type {
  BloomConfig,
  CloudsConfig,
  Game,
  ShadowsConfig,
  SkyConfig,
  SsaoConfig,
  StarsConfig,
  Vec3,
  VehicleReflectionConfig,
  WaterConfig,
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
  /** Current cloud tuning. */
  clouds(): CloudsConfig;
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
  /** Live player position (native Z-up). */
  playerCoords(): Vec3;
  /** Re-drop Tommy at his current spot (to unstick). */
  respawnPlayer(): void;
  /** Tune bloom (enabled/intensity/threshold). */
  setBloom(patch: Partial<BloomConfig>): void;
  /** Tune clouds (coverage/opacity). */
  setClouds(patch: Partial<CloudsConfig>): void;
  /** Set the fog distance (world units to full fog). */
  setFogDistance(distance: number): void;
  /** Set the in-game time (minutes since midnight). */
  setGameTime(minutes: number): void;
  /** Toggle the god-rays post-effect. */
  setGodrays(enabled: boolean): void;
  /** Set the god-rays light-source size (shaft strength). */
  setGodraysSize(size: number): void;
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
  /** Current vehicle-reflection tuning (preset + intensity). */
  vehicleReflection(): VehicleReflectionConfig;
  /** Current water shader tuning. */
  water(): WaterConfig;
  /** Active timecyc weather index. */
  weather(): number;
  /** Selectable weathers (index + label), rain/storm excluded. */
  weatherList(): readonly { index: number; label: string }[];
}

/** Reflection preset cycle order for the debug selector (Off + the registry keys). */
const REFLECTION_PRESETS = ['off', ...Object.keys(PRESETS)];

type Screen = 'game' | 'graphics' | 'map' | 'player' | 'position' | 'root' | 'vehicles' | 'weather';

const MENU: { label: string; screen: Screen }[] = [
  { label: 'Player', screen: 'player' },
  { label: 'Vehicles', screen: 'vehicles' },
  { label: 'Game', screen: 'game' },
  { label: 'Graphics', screen: 'graphics' },
  { label: 'Weather', screen: 'weather' },
  { label: 'Position', screen: 'position' },
  { label: 'Map', screen: 'map' },
];

/** Quick teleport destinations (native GTA Z-up world coords). */
const TELEPORTS: { coords: Vec3; label: string }[] = [
  { coords: PLAYER_SPAWN, label: 'Ganton' },
  { coords: [2860.28, -1887.01, 10.86], label: 'Pier' },
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
  const [mapActive, setMapActive] = useState(false);
  const [fog, setFog] = useState(() => actions.fogDistance());
  const [time, setTime] = useState(() => actions.gameTime());
  const [godrays, setGodrays] = useState(() => actions.godrays());
  const [godraysSize, setGodraysSize] = useState(() => actions.godraysSize());
  const [bloom, setBloom] = useState<BloomConfig>(() => actions.bloom());
  const [clouds, setClouds] = useState<CloudsConfig>(() => actions.clouds());
  const [toneMapping, setToneMapping] = useState(() => actions.toneMapping());
  const [water, setWater] = useState<WaterConfig>(() => actions.water());
  const [reflectionCfg, setReflectionCfg] = useState<VehicleReflectionConfig>(() => actions.vehicleReflection());
  const [ssao, setSsao] = useState<SsaoConfig>(() => actions.ssao());
  const [shadows, setShadows] = useState<ShadowsConfig>(() => actions.shadows());
  const [stars, setStars] = useState<StarsConfig>(() => actions.stars());
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

  // Keep the live clock label ticking while the Game screen is open.
  useEffect(() => {
    if (!visible || screen !== 'game') {
      return;
    }
    const id = setInterval(() => setTime(actions.gameTime()), 500);

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

          {screen === 'game' && (
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

          {screen === 'graphics' && (
            <div style={styles.group}>
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
              {mapActive && <MapInspector game={game} />}
            </div>
          )}
        </>
      )}
    </div>
  );
}
