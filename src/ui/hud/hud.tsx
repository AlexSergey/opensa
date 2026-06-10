import { type CSSProperties, type ReactElement, useEffect, useRef, useState } from 'react';

import type { Game } from '../../game';

import { GameClock } from '../../game/time/game-clock';

/** District label: full opacity for this long, then it fades over {@link ZONE_FADE_MS}. */
const ZONE_HOLD_MS = 3000;
const ZONE_FADE_MS = 1000;

/**
 * The HUD layer (DOM, above the canvas → unaffected by post-processing). Shows the in-game clock top-right
 * (updated on the `'time'` event, frozen while paused) and the **district name** bottom-right, which appears on
 * entering a zone, holds ~3 s, then fades out (GTA-style). Hidden in map-viewer and screenshot (fly) modes.
 */
export function Hud({ game }: { game: Game }): null | ReactElement {
  const [minutes, setMinutes] = useState(() => game.getTime());
  const [zone, setZone] = useState(() => game.getZone());
  const [zoneShown, setZoneShown] = useState(() => game.getZone() !== '');
  const [mapViewer, setMapViewer] = useState(false);
  const [flyCamera, setFlyCamera] = useState(false);
  const zoneTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    // Flash the district name, then schedule the fade-out (hold + CSS opacity transition).
    const flashZone = (name: string): void => {
      clearTimeout(zoneTimerRef.current);
      if (!name) {
        setZoneShown(false);

        return;
      }
      setZone(name);
      setZoneShown(true);
      zoneTimerRef.current = setTimeout(() => setZoneShown(false), ZONE_HOLD_MS);
    };
    if (game.getZone()) {
      zoneTimerRef.current = setTimeout(() => setZoneShown(false), ZONE_HOLD_MS); // fade the zone shown on mount
    }

    const offTime = game.events.on('time', (e) => setMinutes(e.minutes));
    const offZone = game.events.on('zone', (e) => flashZone(e.name));
    const offMap = game.events.on('map-viewer', (e) => setMapViewer(e.enabled));
    const offFly = game.events.on('fly-camera', (e) => setFlyCamera(e.enabled));

    return (): void => {
      clearTimeout(zoneTimerRef.current);
      offTime();
      offZone();
      offMap();
      offFly();
    };
  }, [game]);

  if (mapViewer || flyCamera) {
    return null;
  }

  const { clock, zone: zoneStyle } = game.getConfig().hud;
  const { hud: fonts } = game.getConfig().fonts;
  const clockCss: CSSProperties = {
    color: clock.color,
    fontFamily: `'${fonts.clock}', sans-serif`,
    fontSize: clock.fontSize,
    lineHeight: 1,
    position: 'absolute',
    right: 16,
    top: 10,
    userSelect: 'none',
    WebkitTextStrokeColor: clock.borderColor,
    WebkitTextStrokeWidth: `${clock.borderWidth}px`,
  };
  // District name, bottom-right (where the area name sits in GTA): flashes on entry, then fades out.
  const zoneCss: CSSProperties = {
    bottom: 12,
    color: zoneStyle.color,
    fontFamily: `'${fonts.zone}', sans-serif`,
    fontSize: zoneStyle.fontSize,
    lineHeight: 1,
    opacity: zoneShown ? 1 : 0,
    pointerEvents: 'none',
    position: 'absolute',
    right: 16,
    transition: `opacity ${ZONE_FADE_MS}ms ease`,
    userSelect: 'none',
    WebkitTextStrokeColor: zoneStyle.borderColor,
    WebkitTextStrokeWidth: `${zoneStyle.borderWidth}px`,
  };

  return (
    <>
      <div style={clockCss}>{GameClock.format(minutes)}</div>
      <div style={zoneCss}>{zone}</div>
    </>
  );
}
