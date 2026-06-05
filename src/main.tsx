import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { CanvasHost } from './ui/canvas-host';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <CanvasHost />
  </StrictMode>,
);
