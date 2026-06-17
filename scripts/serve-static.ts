/**
 * Local + E2E static origin (port 3001, matches VITE_STATIC_URL / playwright.config). Serves TWO roots at
 * one origin with fallthrough:
 *  - `static-viewer/` — the small, COMMITTED viewer fixtures (object/vehicle/character dff/txd/col.json), so
 *    the asset-light viewers + their e2e lane run anywhere (incl. CI) without the full game archive.
 *  - `static/`        — the built game archives (gitignored: `<game>-<version>/` chunks + manifest).
 * Their URL prefixes are disjoint (`/viewer/*` vs `/<game>-<version>/*`), so order doesn't matter and a
 * missing `static/` (e.g. CI, which only has `static-viewer/`) just 404s the game archives — viewers still work.
 * Replaces the old single-root `serve static`.
 */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 3001;

const handlers = ['static-viewer', 'static'].filter((dir) => existsSync(dir)).map((dir) => sirv(dir, { dev: true }));

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the app (Vite :5173) fetches this origin cross-port
  let index = 0;
  const next = (): void => {
    const handler = handlers[index];
    index += 1;
    if (handler) {
      handler(req, res, next);
    } else {
      res.statusCode = 404;
      res.end('Not found');
    }
  };
  next();
}).listen(PORT, () => {
  console.log(
    `static server on http://localhost:${PORT} (roots: ${['static-viewer', 'static'].filter(existsSync).join(', ') || 'none'})`,
  );
});
