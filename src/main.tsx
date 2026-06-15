import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GameBootstrap } from './ui/game-bootstrap';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GameBootstrap />
  </StrictMode>,
);
