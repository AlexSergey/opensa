# Changelog

All notable changes to **OpenSA** are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and the project aims to follow
[Semantic Versioning](https://semver.org/). From the first tagged release onward, version sections are
generated from [Conventional Commits](https://www.conventionalcommits.org/) on release (see
`.release-it.json`); the high-level roadmap lives in [roadmap.md](./roadmap.md).

## [Unreleased]

The initial development cycle toward the first release (**0.1.0**). Highlights of what has been built:

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
