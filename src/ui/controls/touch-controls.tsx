import type { TouchInputSource } from '@opensa/game/input';

import { type ReactElement, useCallback, useEffect, useState } from 'react';

import { ActionButton } from './action-button';
import './controls.css';
import { Joystick } from './joystick';
import { usePinchZoom } from './use-pinch-zoom';

interface TouchControlsProps {
  /** Whether enter/exit-vehicle is actionable now — gates the Enter button. Absent ⇒ always shown (harness). */
  canEnterExit?: () => boolean;
  source: TouchInputSource;
}

/** Pinch sensitivity: zoom delta per pixel of finger-spread (the camera applies its own zoom step). */
const PINCH_ZOOM_GAIN = 0.5;

/**
 * On-screen touch controls overlay (plan 055): a movement joystick (left), a look joystick (right) with the
 * action buttons stacked above it, all feeding the {@link TouchInputSource} the game reads. The container is
 * click-through (`pointer-events: none`); only the controls capture pointers. Mount only on touch devices.
 */
export function TouchControls({ canEnterExit, source }: TouchControlsProps): ReactElement {
  // Spreading fingers (positive delta) zooms in → the camera reads a negative zoom (smaller follow distance).
  usePinchZoom(useCallback((delta: number) => source.addZoom(-delta * PINCH_ZOOM_GAIN), [source]));
  const showEnter = usePolledFlag(canEnterExit);

  return (
    <div className="sa-touch">
      {/* Move joystick is screen-space (y down+); the game's forward is screen-up, so invert Y. */}
      <Joystick className="sa-touch__move" label="Move" onChange={(x, y) => source.setMove(x, -y)} />
      <div className="sa-touch__actions">
        {showEnter && <ActionButton label="Enter" onChange={(held) => source.setAction('enterExit', held)} />}
        <ActionButton label="Jump" onChange={(held) => source.setAction('jump', held)} />
      </div>
      <Joystick className="sa-touch__look" label="Look" onChange={(x, y) => source.setLookRate(x, y)} />
    </div>
  );
}

/** Poll a per-frame boolean query into React state (no re-render while unchanged). Absent query ⇒ always true. */
function usePolledFlag(query?: () => boolean): boolean {
  const [value, setValue] = useState(false);

  useEffect(() => {
    if (!query) {
      return;
    }
    let raf = 0;
    const tick = (): void => {
      setValue(query());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return (): void => cancelAnimationFrame(raf);
  }, [query]);

  return query ? value : true;
}
