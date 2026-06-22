/**
 * Local + E2E static origin (port 3001, matches VITE_STATIC_URL / playwright.config). Serves `static/`,
 * which holds both the COMMITTED viewer fixtures (`static/viewer/*` → `/viewer/*`, used by the asset-light
 * viewers + e2e) and the built game archives (`static/games/<game>-<version>/*`, gitignored). CORS on; dev
 * mode reads files fresh and tolerates a missing root. Replaces the old single-root `serve static`.
 */
import { createServer } from 'node:http';
import sirv from 'sirv';

const PORT = Number(process.env.PORT) || 3001;
const serve = sirv('static', { dev: true });

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*'); // the app (Vite :5173) fetches this origin cross-port
  serve(req, res, () => {
    res.statusCode = 404;
    res.end('Not found');
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`static server on http://localhost:${PORT} (root: static)`);
});
