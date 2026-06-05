import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { type ReactElement, Suspense, useState } from 'react';

import type { CameraTarget, GeometryMode } from './components/debug/debug-types';

import { DebugPanel } from './components/debug/debug-panel';
import { MapScene } from './map/map-scene';
import { useArchiveDownload } from './map/use-archive-download';

const BASE = import.meta.env.VITE_STATIC_URL;

const ARCHIVE_URL = `${BASE}/models/gta3.img`;

// CJ's house on Grove Street, Ganton (GTA SA world coords, Z-up).
const GANTON_CJ_HOME: [number, number, number] = [2495, -1687, 13];

export function App(): ReactElement {
  const { archive, error } = useArchiveDownload(ARCHIVE_URL);
  const [geometryMode, setGeometryMode] = useState<GeometryMode>('map');
  const [cameraTarget, setCameraTarget] = useState<CameraTarget>('ganton');

  if (error !== null) {
    return <Overlay text={`Failed to load model archive: ${error}`} />;
  }
  if (archive === null) {
    return <Overlay text="Loading map…" />;
  }

  // Ganton: focus the camera there and load only that district. Full Map: load everything.
  const focus = cameraTarget === 'ganton' ? GANTON_CJ_HOME : undefined;

  return (
    <>
      <Canvas camera={{ far: 100000, near: 0.1, position: [0, 50, 100] }}>
        <ambientLight intensity={1.5} />
        <directionalLight intensity={1.5} position={[50, 100, 50]} />
        <Suspense fallback={null}>
          <MapScene
            archive={archive}
            base={BASE}
            datUrl={`${BASE}/data/gta.dat`}
            focus={focus}
            geometryMode={geometryMode}
          />
        </Suspense>
        <OrbitControls makeDefault />
      </Canvas>
      <DebugPanel
        cameraTarget={cameraTarget}
        geometryMode={geometryMode}
        onCameraTargetChange={setCameraTarget}
        onGeometryModeChange={setGeometryMode}
      />
    </>
  );
}

function Overlay({ text }: { text: string }): ReactElement {
  return (
    <div
      style={{
        alignItems: 'center',
        color: '#fff',
        display: 'flex',
        fontFamily: 'sans-serif',
        height: '100%',
        justifyContent: 'center',
        width: '100%',
      }}
    >
      {text}
    </div>
  );
}
