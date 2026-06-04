import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import { type ReactElement, Suspense } from 'react';

import { MapScene } from './map/map-scene';

const BASE = import.meta.env.VITE_STATIC_URL;

export function App(): ReactElement {
  return (
    <Canvas camera={{ far: 5000, position: [0, 60, 80] }}>
      <ambientLight intensity={1.5} />
      <directionalLight intensity={1.5} position={[50, 100, 50]} />
      <Suspense fallback={null}>
        <MapScene base={BASE} datUrl={`${BASE}/data/gta.dat`} />
      </Suspense>
      <OrbitControls target={[0, 24, 0]} />
    </Canvas>
  );
}
