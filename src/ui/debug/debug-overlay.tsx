import { type ReactElement, useEffect, useState } from 'react';

import type { Game, Vec3 } from '../../game';

import { GameClock } from '../../game/time/game-clock';
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
  /** Flip the occupied car (on wheels → roof, on roof → wheels). No-op on foot. */
  flipVehicle(): void;
  /** Current fog distance (world units to full fog). */
  fogDistance(): number;
  /** Current in-game time (minutes since midnight). */
  gameTime(): number;
  /** Live player position (native Z-up). */
  playerCoords(): Vec3;
  /** Re-drop Tommy at his current spot (to unstick). */
  respawnPlayer(): void;
  /** Set the fog distance (world units to full fog). */
  setFogDistance(distance: number): void;
  /** Set the in-game time (minutes since midnight). */
  setGameTime(minutes: number): void;
  /** Spawn a car just in front of the player. */
  spawnVehicle(model: 'admiral' | 'camper'): Promise<void>;
  /** Teleport the player back to Ganton. */
  teleportToGanton(): void;
}

type Screen = 'game' | 'map' | 'player' | 'root' | 'vehicles';

const MENU: { label: string; screen: Screen }[] = [
  { label: 'Player', screen: 'player' },
  { label: 'Vehicles', screen: 'vehicles' },
  { label: 'Game', screen: 'game' },
  { label: 'Map', screen: 'map' },
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

  // Keep the shown coords live while the Game screen displays them.
  useEffect(() => {
    if (!visible || screen !== 'game' || !showCoords) {
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

          {screen === 'game' && (
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
