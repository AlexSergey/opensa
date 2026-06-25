import react from '@vitejs/plugin-react';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')) as { version: string };

/**
 * Emit the favicon set (icons + `site.webmanifest`) to the build ROOT with STABLE names, so index.html's
 * `<link rel="icon"/manifest>` and the manifest's own root-relative icon paths resolve. Source of truth:
 * `apps/web/src/assets/favicon/`.
 */
function emitFavicons(): Plugin {
  const dir = resolve(__dirname, 'apps/web/src/assets/favicon');

  return {
    generateBundle(): void {
      for (const file of readdirSync(dir)) {
        this.emitFile({ fileName: file, source: readFileSync(resolve(dir, file)), type: 'asset' });
      }
    },
    name: 'emit-favicons',
  };
}

/** Copy `deploy/.htaccess` into the build output so the Apache config (HTTPS/SPA/caching/MIME) ships with
 *  `dist/` — upload the whole folder to the web root. See `deploy/README.md`. */
function emitHtaccess(): Plugin {
  return {
    generateBundle(): void {
      this.emitFile({
        fileName: '.htaccess',
        source: readFileSync(resolve(__dirname, 'deploy/.htaccess')),
        type: 'asset',
      });
    },
    name: 'emit-htaccess',
  };
}

/**
 * Emit the social-share preview to `dist/assets/og.jpg` with a STABLE name (no content hash), so the
 * `og:image` / `twitter:image` meta can point at a fixed URL (https://opensa.cc/assets/og.jpg).
 * Source of truth: `apps/web/src/assets/og.jpg`.
 */
function emitOgImage(): Plugin {
  return {
    generateBundle(): void {
      this.emitFile({
        fileName: 'assets/og.jpg',
        source: readFileSync(resolve(__dirname, 'apps/web/src/assets/og.jpg')),
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

// The prod deploy build (`npm run build:prod` sets both flags) — gates deploy-only output like `.htaccess`.
const isProdDeploy = excludeViewers && hideDebugger;

const viewerInputs = {
  controlsHarness: resolve(__dirname, 'controls-harness.html'),
  viewer: resolve(__dirname, 'viewer.html'), // object/vehicle/character as ?tab= in one app
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
    // Build version usable in code as `__APP_VERSION__` (typed in apps/web/vite-env.d.ts).
    __APP_VERSION__: JSON.stringify(pkg.version),
    // Hide dev-only debugger sections — true only in the deploy build (build:prod), false in `build`/`dev`.
    __DEBUGGER_HIDE__: JSON.stringify(hideDebugger),
    // Guarantee `process.env.NODE_ENV === 'production'` resolves statically (build → production, serve → development).
    'process.env.NODE_ENV': JSON.stringify(command === 'build' ? 'production' : 'development'),
  },
  plugins: [
    react(),
    emitOgImage(),
    emitFavicons(),
    injectVersionComment(pkg.version),
    ...(isProdDeploy ? [emitHtaccess()] : []), // ship deploy/.htaccess in dist only for build:prod
  ],
}));
