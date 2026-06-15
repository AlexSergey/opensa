import { type ReactElement, useEffect, useState } from 'react';

import type { AssetFileSystem } from '../renderware';

import { AssetLoader } from '../asset-loader';
import { Vfs } from '../vfs';
import { CanvasHost, LoadOverlay } from './canvas-host';

/**
 * Temporary boot wiring (plan 050): download all chunks with the loader, unzip them into the VFS, verify
 * against the manifest, then mount `CanvasHost` reading from the VFS. The real progress UI (splash/bar
 * bound to the loader's events) is a later plan — this just gates the game on a complete asset set.
 */
const BASE = import.meta.env.VITE_STATIC_URL;
// The built variant's chunk directory (`<game>-<pkgVersion>/`). Temporary: hard-coded until a proper
// boot/version selector exists.
const MANIFEST_URL = `${BASE}/original-0.1.0/manifest.json`;

// One asset load per page (module scope) so React StrictMode's dev double-mount doesn't load twice.
let assetsPromise: null | Promise<AssetFileSystem> = null;

export function GameBootstrap(): ReactElement {
  const [fs, setFs] = useState<AssetFileSystem | null>(null);
  const [errorText, setErrorText] = useState('');

  useEffect(() => {
    let disposed = false;
    loadAssets()
      .then((ready) => {
        if (!disposed) {
          setFs(ready);
        }
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setErrorText(String(error));
        }
      });

    return (): void => {
      disposed = true;
    };
  }, []);

  if (errorText) {
    return <LoadOverlay text={`Failed to load assets: ${errorText}`} />;
  }
  if (!fs) {
    return <LoadOverlay text="Downloading assets…" />;
  }

  return <CanvasHost fs={fs} />;
}

function loadAssets(): Promise<AssetFileSystem> {
  assetsPromise ??= (async (): Promise<AssetFileSystem> => {
    const vfs = new Vfs();
    const loader = new AssetLoader({ manifestUrl: MANIFEST_URL, sink: vfs });
    const manifest = await loader.init();
    await loader.load();
    const problems = vfs.verify(manifest);
    if (problems.length > 0) {
      throw new Error(`asset verification failed: ${problems.join('; ')}`);
    }

    return vfs;
  })();

  return assetsPromise;
}
