# Architecture

A high-level map of OpenSA. Two levels: the **modules** and how they depend on each other, then a
**detailed** look inside them, plus the **boot** and **build** flows. Details are intentionally trimmed for
readability — see [docs/features/](./features/) and [docs/plans/](./plans/) for specifics.

## Level 1 — modules

```mermaid
flowchart TB
  static[("static/ — built chunks + manifest")]:::data
  ui["UI&nbsp;&middot; React shell + game surface"]:::ui
  loader["asset-loader&nbsp;&middot; download + cache"]:::infra
  vfs["vfs&nbsp;&middot; unzip + serve files"]:::infra
  game["game&nbsp;&middot; engine, ECS, systems"]:::engine
  rw["renderware&nbsp;&middot; parsers, world, builders"]:::lib
  ext["three.js &middot; Rapier &middot; fflate"]:::ext

  ui --> loader
  ui --> game
  static -->|fetch| loader
  loader -->|raw zip chunks| vfs
  game -->|reads via AssetFileSystem| vfs
  game --> rw
  game --> ext
  rw --> ext

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef lib fill:#d8f5e0,stroke:#1f9d55,color:#111
  classDef ext fill:#ededed,stroke:#999,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

**Rules of the road**

- **`AssetFileSystem`** (defined in `renderware/archive`) is the seam: the game reads files through it and
  doesn't care that the **vfs** provides them today.
- Only **`game/adapters`** (and `game/mods`) may import **renderware** — it's the leaf layer.
- **asset-loader** and **vfs** are standalone (no React, no game).
- three.js / Rapier load **lazily** with the game surface, so the UI shell paints instantly.

## Level 2 — inside the modules

```mermaid
flowchart LR
  subgraph UI["ui"]
    shell["shell&nbsp;&middot; boot-machine, use-asset-boot,<br/>menu / preloader / disclaimer"]:::ui
    canvas["canvas-host&nbsp;(lazy game surface)"]:::ui
    debug["debug overlay (F2) + viewers"]:::ui
  end

  subgraph LOADER["asset-loader"]
    al["AssetLoader&nbsp;&middot; manifest, Cache Storage,<br/>progress events"]:::infra
  end

  subgraph VFS["vfs"]
    v["Vfs&nbsp;&middot; unzip (fflate) → AssetFileSystem"]:::infra
  end

  subgraph GAME["game"]
    core["core&nbsp;&middot; Game loop, renderer, camera"]:::engine
    sys["systems&nbsp;&middot; streaming, physics, character,<br/>vehicle, time, weather, zones"]:::engine
    plug["plugins&nbsp;&middot; sky, water, fog, post-FX, reflections"]:::engine
    adp["adapters&nbsp;&middot; GtaSaWorldAdapter"]:::engine
  end

  subgraph RW["renderware"]
    par["parsers&nbsp;&middot; DFF/TXD/COL + IDE/IPL/DAT/GXT"]:::lib
    arc["archive&nbsp;&middot; ImgArchive, AssetFileSystem (iface)"]:::lib
    mp["map&nbsp;&middot; resolve-map, world-grid, build-cell"]:::lib
    th["three builders + collision"]:::lib
  end

  shell --> al
  shell --> canvas
  al -->|chunks| v
  canvas --> core
  canvas --> adp
  core --> sys
  core --> plug
  adp --> par
  adp --> mp
  adp --> th
  adp -->|reads files| v
  v -. implements .-> arc

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef lib fill:#d8f5e0,stroke:#1f9d55,color:#111
```

## Boot flow (first visit)

```mermaid
flowchart TB
  a([main → App]):::ui --> b["core&nbsp;&middot; load priority + models<br/>loader → vfs"]:::infra
  b --> m["MENU"]:::ui
  m -->|Play| d["disclaimer"]:::ui
  d --> t["textures&nbsp;&middot; load + verify"]:::infra
  t --> w["warmup&nbsp;&middot; lazy canvas-host,<br/>build Game + adapter, loadGame"]:::engine
  w -->|world-ready| p([PLAYING]):::engine
  p -->|Esc| m

  b -. fail .-> e["error + retry"]:::data
  t -. fail .-> e
  e -->|retry &times;3 exhausted| m

  classDef ui fill:#ffe6cc,stroke:#f55c07,color:#111
  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef engine fill:#d8ecff,stroke:#2a7ae2,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

Return visits skip the intro animation (a localStorage flag) and re-use the Cache-Storage chunks.

## Build pipeline (offline)

```mermaid
flowchart LR
  src[("game-src/&lt;game&gt;/<br/>your GTA SA files")]:::data
  build["scripts/build-game.ts<br/>partition + ~50MB hashed chunks"]:::infra
  out[("static/&lt;game&gt;-&lt;version&gt;/<br/>priority &middot; models &middot; textures &middot; manifest")]:::data

  src -->|npm run build:game:original| build --> out
  out -.->|served at runtime| loader[["asset-loader"]]:::infra

  classDef infra fill:#e8e0ff,stroke:#6b4fbb,color:#111
  classDef data fill:#f5efe1,stroke:#b08900,color:#111
```

> Runtime in one line: **static chunks → asset-loader (cache) → vfs (unzip) → AssetFileSystem → game ←
> renderware → three.js + Rapier**, all behind an instant React shell.
