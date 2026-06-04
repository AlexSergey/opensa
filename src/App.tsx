import { Suspense } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { DFFLoader, TXDLoader } from './renderware';

const BASE = import.meta.env.VITE_STATIC_URL;

function Model() {
  const textures = useLoader(TXDLoader, `${BASE}/bsor.txd`);
  const model = useLoader(DFFLoader, `${BASE}/bsor_cedar1_hi.dff`, (loader) => {
    loader.setTextures(textures);
  });
  return <primitive object={model} />;
}

export function App() {
  return (
    <Canvas camera={{ position: [0, 4, 10] }}>
      <ambientLight intensity={1.5} />
      <directionalLight position={[5, 10, 5]} intensity={1.5} />
      <Suspense fallback={null}>
        <Model />
      </Suspense>
      <OrbitControls target={[0, 4, 0]} />
    </Canvas>
  );
}
