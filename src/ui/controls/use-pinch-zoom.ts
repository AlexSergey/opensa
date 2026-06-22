import { useEffect } from 'react';

/**
 * Two-finger pinch → a zoom delta (plan 055). Listens on `window` (so it never blocks the joysticks/canvas)
 * and reports the change in finger distance each move (px; positive = spreading apart). `preventDefault` stops
 * the browser's native page zoom. `onPinch` must be stable (wrap in `useCallback`) so the listener isn't
 * re-subscribed every render.
 */
export function usePinchZoom(onPinch: (deltaPx: number) => void): void {
  useEffect(() => {
    let lastDistance = 0;
    const distance = (touches: TouchList): number =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onMove = (event: TouchEvent): void => {
      if (event.touches.length !== 2) {
        return;
      }
      event.preventDefault();
      const next = distance(event.touches);
      if (lastDistance !== 0) {
        onPinch(next - lastDistance);
      }
      lastDistance = next;
    };
    const onEnd = (event: TouchEvent): void => {
      if (event.touches.length < 2) {
        lastDistance = 0; // re-seed when the next pinch starts
      }
    };

    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('touchcancel', onEnd);

    return (): void => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [onPinch]);
}
