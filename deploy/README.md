# Deploy (shared hosting + Apache)

How to put OpenSA online on a shared host with Apache and a bound domain. Two parts ship: the **app**
(`dist/`, a static SPA) and the **game asset archives** (`static/<game>-<version>/`, large binary chunks).

> **HTTPS is required.** The asset loader uses the Cache Storage API, which only works in a secure context.
> Enable TLS (most hosts offer free Let's Encrypt). The bundled `.htaccess` also forces `http → https`.

## 1. Configure the build

`VITE_STATIC_URL`, `VITE_GAME_TYPE`, `VITE_GA_ID` are baked in at build time. Put the **production** values
in **`.env.production`** (gitignored; `vite build` auto-loads it in production mode and it overrides `.env`).
Keep `.env` for local dev (e.g. `VITE_STATIC_URL=http://localhost:3001`).

```dotenv
# .env.production  (create it — gitignored)
VITE_STATIC_URL=https://yourdomain.tld/static   # https + reachable by visitors (your domain or a CDN, step 5)
VITE_GAME_TYPE=original                          # which variant to boot
VITE_GA_ID=G-XXXXXXXXXX                          # optional: Google Analytics (gtag injected only when set)
```

> Do **not** ship a localhost `VITE_STATIC_URL` to prod — the live site would try to fetch from the
> visitor's machine, triggering the browser "access local network" prompt + mixed-content blocking.
> Note: plain `npm run build` is also production mode, so it reads `.env.production` too — only `npm run dev`
> uses `.env`.

## 2. Build the app

```bash
npm ci
npm run build:prod      # drops the dev viewers + hides the debugger, and emits dist/.htaccess
```

Output: `dist/` — the SPA, plus `dist/.htaccess` (the Apache config, copied from `deploy/.htaccess` only
on `build:prod`).

## 3. Build the game archives

These are **not** in git and are large (textures alone is hundreds of MB). Build the variant you set in
`VITE_GAME_TYPE`:

```bash
npm run build:game:original          # → static/original-<version>/  (manifest.json + chunk zips)
# or: npm run build:game:original-extend, etc.
```

> The folder name is `<GAME_TYPE>-<version>` where `<version>` is `package.json`'s version. The runtime
> fetches `${VITE_STATIC_URL}/<GAME_TYPE>-<version>/manifest.json`, so **the names must line up**. If you
> bump the version, rebuild the archives and re-upload the new folder (a stale/missing manifest → 404).

## 4. Upload to the web root

Upload (FTP/SFTP/SSH) so the served layout is:

```
<web root>/
  index.html
  .htaccess              # from dist/ (already configured: HTTPS, SPA fallback, caching, MIME)
  assets/                # hashed js/css/fonts/og.png
  static/
    original-<version>/
      manifest.json
      priority-<hash>.zip
      models-<hash>.zip
      textures-<hash>.zip
```

- Everything inside `dist/` → the web root.
- The `static/<game>-<version>/` folder → under the web root (or wherever `VITE_STATIC_URL` points).
- Make sure `.htaccess` made it (dotfiles are hidden in some FTP clients — enable "show hidden files").

## 5. (Optional) Offload the heavy assets

The `textures` chunks are the bulk of the traffic. If the shared host's disk/bandwidth quota is tight,
serve `static/` from a CDN / object storage (Cloudflare R2, Backblaze B2, etc.) instead, and point
`VITE_STATIC_URL` at it (rebuild step 2). Then Apache only serves the light `dist/`.

## Checklist

- [ ] HTTPS on, `http → https` redirect working.
- [ ] `.htaccess` present in the web root (SPA fallback returns `index.html` for unknown paths).
- [ ] `VITE_STATIC_URL` + `VITE_GAME_TYPE` matched the build, and the `static/<game>-<version>/` folder name
      matches `package.json`'s version.
- [ ] `manifest.json` and `index.html` are served `no-cache`; hashed assets/chunks are cached immutable
      (the bundled `.htaccess` does this).
- [ ] Open the site → menu loads → Play streams the world. Check the Network tab: the chunk zips download
      from `VITE_STATIC_URL` with 200/206 (Range) and get cached on reload.

## Notes

- **No COOP/COEP needed.** Rapier runs single-threaded WASM and three.js needs no `SharedArrayBuffer`, so
  cross-origin-isolation headers are unnecessary.
- Range requests (resumable / parallel chunk downloads) are served by Apache by default.
- The chunk zips are already compressed — `.htaccess` only gzips text types, leaving them as-is.
