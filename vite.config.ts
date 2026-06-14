import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

/**
 * Emit the social-share preview to `dist/assets/og.png` with a STABLE name (no content hash), so the
 * `og:image` / `twitter:image` meta can point at a fixed URL (https://opensa.cc/assets/og.png).
 * Source of truth: `src/assets/og.png`.
 */
function emitOgImage(): Plugin {
  return {
    generateBundle(): void {
      this.emitFile({
        fileName: 'assets/og.png',
        source: readFileSync(resolve(__dirname, 'src/assets/og.png')),
        type: 'asset',
      });
    },
    name: 'emit-og-image',
  };
}

/** Stamp the build version as an HTML comment at the top of index.html's <head> (main entry only). */
function injectVersionComment(version: string): Plugin {
  return {
    name: 'inject-version-comment',
    transformIndexHtml: {
      handler(html, ctx): string {
        if (!ctx.filename.endsWith('index.html')) {
          return html; // skip the viewer entries
        }

        return html.replace('<head>', `<head>\n    <!-- OpenSA v${version} -->`);
      },
      order: 'pre',
    },
  };
}

// Prod deploy build drops the dev viewer HTML entries (OPENSA_NO_VIEWERS=true via `npm run build:prod`).
const excludeViewers = process.env.OPENSA_NO_VIEWERS === 'true';

// Hide the authoring/tuning debugger sections — only in the deploy build (OPENSA_DEBUGGER_HIDE=true via `build:prod`).
const hideDebugger = process.env.OPENSA_DEBUGGER_HIDE === 'true';

const viewerInputs = {
  characterViewer: resolve(__dirname, 'character-viewer.html'),
  objectViewer: resolve(__dirname, 'object-viewer.html'),
  vehicleViewer: resolve(__dirname, 'vehicle-viewer.html'),
};

export default defineConfig(({ command }) => ({
  build: {
    rollupOptions: {
      input: excludeViewers
        ? { main: resolve(__dirname, 'index.html') }
        : { main: resolve(__dirname, 'index.html'), ...viewerInputs },
    },
  },
  define: {
    // Build version usable in code as `__APP_VERSION__` (typed in src/vite-env.d.ts).
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Hide dev-only debugger sections — true only in the deploy build (build:prod), false in `build`/`dev`.
    __DEBUGGER_HIDE__: JSON.stringify(hideDebugger),
    // Guarantee `process.env.NODE_ENV === 'production'` resolves statically (build → production, serve → development).
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
  },
  plugins: [react(), emitOgImage(), injectVersionComment(pkg.version)],
}));
