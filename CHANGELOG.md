# Changelog

# 0.2.0 (2026-06-23)

### Added

- **Multi-game runtime catalogue** — `GAME_CONFIG` (`src/game-config.tsx`) replaces the single-game `.env`
  setup: the menu lists every game and you pick one at runtime, each with its own loader, world/player setup,
  parked vehicles, teleports, and a disclaimer remembered per game.
- **Pluggable asset loaders** — a `fetch` loader (download content-hashed chunk archives) and a new **local
  raw-install loader**: point the app at your own GTA install folder via the File System Access API; nothing
  is uploaded, files are read locally in the browser (bring-your-own-files).
- **Locked / anti-rip model support** — recover protected (encrypted) DFF/TXD so community mod models load.
- **Mobile / touch controls** — on-screen move & look joysticks, jump, and pinch-zoom.
- **Branding** — new OpenSA logo, a full favicon set + web manifest, and a social-share (`og.jpg`) image.

### Changed

- **Repositioned as a RenderWare-compatible game engine** — README, blog, docs, package metadata and the
  in-app tagline now lead with the engine (compatible with RenderWare; runs GTA San Andreas and its mods)
  rather than "GTA San Andreas in the browser".
- **Boot flow is menu-first** — nothing downloads until a game is picked; a single loading screen pulls all
  groups; removed the eager pre-menu core download and the first-visit intro animation.
- **Cache management reworked** — per-build-version Cache Storage with a fallback strategy; a revoked build
  (a missing `data` probe **or** `manifest.json`) wipes the client cache.
- **Unified player spawn** — a single `playerSpawn` per game seeds both the capsule and the initial collision
  zone.
- **Input refactored** into pluggable sources (keyboard / pointer / touch).
- **Debugger** — the Position tab (live coords + city) is always available; teleport lists are per-game.

### Fixed

- Custom-ped **root-bone offset** — peds whose `Root` frame is authored off-origin (some mods) no longer
  render off-centre or orbit the pivot when turning.
- Character **material issues** and animation retargeting on custom / renamed-skeleton models.

### Removed

- **All bundled game assets** — dropped the committed player model and other assets; the project ships **no
  game files**, you supply your own copy. Test fixtures use local, gitignored real assets.

### Legal & safety

- Added a **Legal & takedowns** section (README) and an in-app disclaimer with a rights-holder contact.

# 0.1.0 (2026-06-18)

### Added

- **Engine / renderer** — from-scratch RenderWare pipeline: DFF (models) and TXD (textures) parsers, COL
  collision, IMG archive reader, and IPL/IDE world streaming with LOD swap, frustum culling, and fog-tied
  draw distance.
- **Physics & player** — Rapier-backed player controller (walk / run / jump, grounded state), follow camera
  with mouse look, and a K+M free-fly screenshot camera.
- **Character** — skinned ped with `ped.ifp` animations driven by a movement state machine.
- **Vehicles** — loader with embedded collision, full dummy framework (doors / headlights / seats), enter &
  exit with door animation, physics + basic controls, damage (ramming + struck), VLO, and car2/car4 carcols.
- **World content** — water surface + shader, game time and timecyc (sunny, normalized to 24h), weather
  manager with `map.zon` zone detection, districts via `info.zon` + GXT, teleports, animated map objects
  (UV + DFF), procedural ground clutter (procobj), road-sign text (2dfx), basic world effects, particles,
  and breakable objects, night-time objects (tobj), and vehicle headlights + reflections.
- **Graphics** — lighting, shadows, sky/skybox with volumetric clouds, fog, god rays, bloom, SSAO, and ACES
  tone mapping.
- **Build & delivery** — game-build archives split into priority / models / textures, repacked into ~50 MB
  content-hashed chunks; an asset **loader** (on-demand download, Cache Storage caching, invalidation,
  progress events) and a **Virtual File System** (unzip + serve) that the game reads everything through.
- **UI shell** — instant-loading React shell with a branded intro animation, menu, disclaimer, error/retry,
  Esc pause menu, lazy-loaded game, an in-game F2 tip, fullscreen + mouse capture (pointer lock), and opt-in
  analytics.
- **Tooling** — F2 in-game debugger (map viewer, spawn / flip / teleport, live tuning), standalone
  object/vehicle/character viewers, a logger, and offline debug scripts.
- **Project** — docs (getting-started, dev docs, per-feature reference), a repo blog, and contribution guide.

### Changed

- Renamed the project to **OpenSA**.
- Assets are sourced from `game-src/<game>/` and shipped as built archives under `static/`; at runtime the
  game reads from the VFS instead of fetching loose files.

### Fixed

- Truth's Farm (Countryside) rendering.
- Vehicle windscreen alpha-channel bug.
- Water flooding tunnels across the map.
- Shadow acne on small objects.
- Streaming "blinking" during LOD <-> HD swaps.
