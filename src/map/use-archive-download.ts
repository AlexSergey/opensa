import { useEffect, useState } from 'react';

import type { ImgArchive } from './img-archive';

import { loadArchive } from './img-archive';

interface ArchiveState {
  archive: ImgArchive | null;
  error: null | string;
}

/**
 * Download the WIMG model archive once. The whole map is one request instead of
 * thousands of per-asset fetches, so a missing/slow asset can't blank the app.
 */
export function useArchiveDownload(url: string): ArchiveState {
  const [state, setState] = useState<ArchiveState>({ archive: null, error: null });

  useEffect(() => {
    let cancelled = false;

    loadArchive(url)
      .then((archive) => {
        if (!cancelled) {
          setState({ archive, error: null });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({ archive: null, error: String(error) });
        }
      });

    return (): void => {
      cancelled = true;
    };
  }, [url]);

  return state;
}
