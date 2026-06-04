import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { type ReactElement, Suspense } from 'react';

import { MapScene } from './map/map-scene';

const BASE = import.meta.env.VITE_STATIC_URL;

// CJ's house on Grove Street, Ganton (GTA SA world coords, Z-up).
const GANTON_CJ_HOME: [number, number, number] = [2495, -1687, 13];

export function App(): ReactElement {
  return (
    <Canvas camera={{ far: 100000, near: 0.1, position: [0, 50, 100] }}>
      <ambientLight intensity={1.5} />
      <directionalLight intensity={1.5} position={[50, 100, 50]} />
      <Suspense fallback={null}>
        <MapScene base={BASE} datUrl={`${BASE}/data/gta.dat`} focus={GANTON_CJ_HOME} />
      </Suspense>
      <OrbitControls makeDefault />
    </Canvas>
  );
}
