import { type CSSProperties, type ReactElement, useEffect, useState } from 'react';

import type { Game } from '../../game';

import { GameClock } from '../../game/time/game-clock';

/**
 * The HUD layer (DOM, above the canvas → unaffected by post-processing). Shows the
 * in-game clock top-right, updated on the `'time'` event (frozen while paused, since
 * the clock only advances during play). Hidden in map-viewer and screenshot (fly)
 * modes for a clean view.
 */
export function Hud({ game }: { game: Game }): null | ReactElement {
  const [minutes, setMinutes] = useState(() => game.getTime());
  const [mapViewer, setMapViewer] = useState(false);
  const [flyCamera, setFlyCamera] = useState(false);

  useEffect(() => {
    const offTime = game.events.on('time', (e) => setMinutes(e.minutes));
    const offMap = game.events.on('map-viewer', (e) => setMapViewer(e.enabled));
    const offFly = game.events.on('fly-camera', (e) => setFlyCamera(e.enabled));

    return (): void => {
      offTime();
      offMap();
      offFly();
    };
  }, [game]);

  if (mapViewer || flyCamera) {
    return null;
  }

  const { clock } = game.getConfig().hud;
  const style: CSSProperties = {
    color: clock.color,
    fontFamily: `'${game.getConfig().fonts.hud.clock}', sans-serif`,
    fontSize: clock.fontSize,
    lineHeight: 1,
    position: 'absolute',
    right: 16,
    top: 10,
    userSelect: 'none',
    WebkitTextStrokeColor: clock.borderColor,
    WebkitTextStrokeWidth: `${clock.borderWidth}px`,
  };

  return <div style={style}>{GameClock.format(minutes)}</div>;
}
