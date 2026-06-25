import { type ReactElement, useEffect, useRef, useState } from 'react';

const HINT = 'Press F2 to open the debug menu — spawn a car, teleport to another city, change the weather, and more.';
const FIRST_DELAY_MS = 5000; // ~5 s after the game appears
const REPEAT_DELAY_MS = 5 * 60 * 1000; // once more, 5 min later, then never again this session
const LIFETIME_MS = 9000; // matches the sa-notif fade-in/out keyframe

/**
 * Session-scoped F2 tip (plan 051 follow-up): a top-left info notification ~5 s after the game appears,
 * repeated once after 5 min, then not again. Not persisted — a fresh session shows it again. Dismissing it
 * (the × button) stops it for the rest of the session. Mount while the game is on screen (playing/paused);
 * the timers survive pausing.
 */
export function GameHint(): null | ReactElement {
  const [visible, setVisible] = useState(false);
  const dismissedRef = useRef(false);

  useEffect(() => {
    let hideId: number | undefined;
    const show = (): void => {
      if (dismissedRef.current) {
        return; // user closed it — don't show again this session
      }
      setVisible(true);
      hideId = window.setTimeout(() => setVisible(false), LIFETIME_MS);
    };
    const firstId = window.setTimeout(show, FIRST_DELAY_MS);
    const repeatId = window.setTimeout(show, FIRST_DELAY_MS + REPEAT_DELAY_MS);

    return (): void => {
      clearTimeout(firstId);
      clearTimeout(repeatId);
      clearTimeout(hideId);
    };
  }, []);

  if (!visible) {
    return null;
  }

  return (
    <div className="sa-notif" role="status">
      <span aria-hidden className="sa-notif__icon">
        !
      </span>
      <div>
        <div className="sa-notif__title">Tip</div>
        <p className="sa-notif__msg">{HINT}</p>
      </div>
      <button
        aria-label="Dismiss"
        className="sa-notif__close"
        onClick={() => {
          dismissedRef.current = true;
          setVisible(false);
        }}
        type="button"
      >
        ×
      </button>
    </div>
  );
}
