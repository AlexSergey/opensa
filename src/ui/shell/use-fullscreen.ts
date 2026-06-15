import { useCallback, useEffect, useState } from 'react';

/** Page fullscreen toggle (plan 051 follow-up). Targets the document element so the HUD/menu overlays
 *  stay visible. `isFullscreen` tracks the browser (Esc exits it on its own). */
export interface FullscreenControl {
  isFullscreen: boolean;
  toggle: () => void;
}

export function useFullscreen(): FullscreenControl {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = (): void => setIsFullscreen(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', onChange);

    return (): void => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback((): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => false);
    } else {
      void document.documentElement.requestFullscreen().catch(() => false); // denied / unsupported → ignore
    }
  }, []);

  return { isFullscreen, toggle };
}
