import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        characterViewer: resolve(__dirname, 'character-viewer.html'),
        main: resolve(__dirname, 'index.html'),
        objectViewer: resolve(__dirname, 'object-viewer.html'),
        vehicleViewer: resolve(__dirname, 'vehicle-viewer.html'),
      },
    },
  },
  plugins: [react()],
});
