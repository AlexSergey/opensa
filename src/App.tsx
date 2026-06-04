import type { ReactElement } from 'react';

import { OrbitControls } from '@react-three/drei';
import { Canvas, useLoader } from '@react-three/fiber';
import { Suspense } from 'react';

import { DFFLoader, TXDLoader } from './renderware';

const BASE = import.meta.env.VITE_STATIC_URL;

export function App(): ReactElement {
  return (
    <Canvas camera={{ position: [0, 4, 10] }}>
      <ambientLight intensity={1.5} />
      <directionalLight intensity={1.5} position={[5, 10, 5]} />
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <OrbitControls target={[0, 4, 0]} />
    </Canvas>
  );
}

function Model(): ReactElement {
  const textures = useLoader(TXDLoader, `${BASE}/bsor.txd`);
  const model = useLoader(DFFLoader, `${BASE}/bsor_cedar1_hi.dff`, (loader) => {
    loader.setTextures(textures);
  });

  return <primitive object={model} />;
}
