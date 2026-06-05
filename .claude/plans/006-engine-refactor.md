# Engine refactor — decouple from R3F, layer game vs renderware, plugin API

## Context & goals

The app works (full SA map, archive streaming, instancing, debug overlay) but the rendering is bound
to **react-three-fiber** (`src/map/*.tsx`, `app.tsx`: `useLoader`/`useFrame`/`useThree`/`Suspense`,
JSX `<instancedMesh>`/`<group>`). We want:

1. **No framework lock-in** — an imperative, framework-agnostic engine; React kept only as a thin
   canvas mount + the DOM debug overlay (drop `@react-three/fiber` + `@react-three/drei`).
2. **Two layers + an adapter seam**:
   - **`game`** — generic engine (renderer/scene/camera/loop, plugins, streaming, ECS, physics).
     *Never imports renderware.*
   - **`renderware`** — all GTA SA specifics (parsers, three-conversion, IMG archive, map resolution).
   - **`game/adapters`** — the **only** place that bridges `game` ↔ `renderware`.
3. **A good, extensible API** — a class-interface **plugin** system (lighting now; shaders/post-fx
   later via render hooks), and a `Game` **singleton** (init → loadGame(coords) → debugMode/config/refresh).
4. **Plan ahead** for: collision (COL), character spawn, world streaming + LODs, physics — likely
   **bitECS** + **Rapier**.

This plan is the architecture + a **phased, test-green migration**. (Future systems — streaming, ECS,
physics — get their own follow-up plans; here we only carve the seams for them.)

## Current coupling (what moves where)

| Current (`src/`) | Coupling | Target |
|---|---|---|
| `renderware/parser/*`, `gta-sa-parsers/*` | pure (no three) | **`renderware/parsers/*`** (merged) |
| `renderware/three/*` (buildClump(Parts), buildTexture, dff/txd-loader) | three only | **`renderware/three/*`** (unchanged) |
| `map/img-archive`, `asset-cache`, `resolve-paths`, `model-key` | pure/three | **`renderware/archive/*`** |
| `map/use-gta-map` (Suspense `use()`) | React | **`renderware/map/resolve-map.ts`** (async fn) |
| `map/use-model-parts` (`useMemo`) | React | folded into `renderware/map` (cache by model key) |
| `map/model-instances.tsx` (JSX InstancedMesh + `useLayoutEffect` matrices + onClick) | R3F | **`renderware/map/build-region.ts`** (imperative InstancedMesh) |
| `map/fit-camera.tsx` (`useFrame`) | R3F | imperative `game/core/camera-fit.ts` |
| `map/map-scene.tsx` (`<group>`, grouping, Suspense) | R3F | `renderware/map` builder + `game` scene.add |
| `map/use-archive-download` (`useState`/`useEffect`) | React | `renderware/archive/load-archive` + game progress events |
| `app.tsx` (`<Canvas>`) | R3F | `ui/` canvas mount → `Game` |
| `components/debug/*` | React DOM (not R3F) | **`ui/debug/*`** (talks to `Game`) |

## Target structure

```
src/
  game/                         # generic engine — MUST NOT import renderware (lint-enforced)
    game.ts                     # Game singleton (extends EventEmitter)
    core/
      renderer.ts               # WebGLRenderer + scene + camera creation from a canvas
      loop.ts                   # tick: fixed-step systems (accumulator) → plugin.update → pipeline.render
      system.ts                 # System interface + ordered registry (ECS/physics/streaming plug in here)
      view.ts                   # focus/view target (a Vec3 source); streaming + camera read it
      camera-controller.ts      # modes: fit-region (now) | follow-entity (player, later)
      clock.ts, resize.ts, raycast.ts
    plugins/
      plugin.ts                 # Plugin + PluginContext interfaces, RenderPipeline
      ambient-light.plugin.ts, directional-light.plugin.ts, controls.plugin.ts
    interfaces/
      config.interface.ts       # Config
      world-adapter.interface.ts# WorldAdapter contract (returns THREE.Object3D[])
      public-api.ts
    adapters/
      gta-sa-world.adapter.ts   # implements WorldAdapter via renderware  ← only renderware importer
    events/events.global.ts
  renderware/                   # GTA SA engine specifics
    parsers/                    # dff, txd, chunks, binary-stream, dat, ide, ipl, ipl-binary, lod, text-lines (+ tests)
    three/                      # buildClump(Parts), buildTexture (THREE objects, no R3F)
    archive/                    # img-archive (WIMG), asset-cache, manifest, resolve-paths, model-key
    map/                        # resolve-map (dat→catalog→instances), build-region (imperative instancing), camera anchors
    index.ts                    # public renderware API
  ui/                           # React: thin shell, no R3F
    canvas-host.tsx             # mounts <canvas>, creates Game on the element
    debug/                      # debug panel/overlay (DOM) → calls Game
  main.tsx
```

`three` is the shared rendering substrate for **both** layers (it is not "renderware"); renderware
produces `THREE.Object3D`s, game adds/renders them. Only `game/adapters/**` may `import` renderware.

## The adapter seam (heart of the decoupling)

```ts
// game/interfaces/world-adapter.interface.ts  — generic, no renderware import
export interface WorldObjectInfo { modelName: string; txdName: string; position: Vec3; }
export interface RegionRequest { center: Vec3; radius: number; geometry: 'map' | 'lods'; }

export interface WorldAdapter {
  /** Download/parse everything needed (archive, gta.dat, IDE/IPL). Reports 0..1. */
  prepare(onProgress?: (fraction: number) => void): Promise<void>;
  /** Build renderable objects for a region (instanced). */
  loadRegion(req: RegionRequest): Promise<THREE.Object3D[]>;
  /** Map a picked object+instance back to its source info (debug click-inspect). */
  describe(object: THREE.Object3D, instanceId?: number): WorldObjectInfo | null;
}
```

`game/adapters/gta-sa-world.adapter.ts` implements it with `renderware/{archive,map,three}`:
`prepare` = `loadArchive` + `resolveMap`; `loadRegion` = `buildRegion(defs, archive, req)` → returns
`InstancedMesh[]`; `describe` = lookup via `userData` stamped on each InstancedMesh. The Game core
calls these — it never names a `.dff`/`.txd`/IPL. Enforce with eslint `no-restricted-imports`
(`game/**` may not import `../renderware` except `game/adapters/**`).

## Plugin system (class-interface, shader-ready)

```ts
export interface PluginContext {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly config: Readonly<Config>;
  readonly events: EventBus;
  readonly pipeline: RenderPipeline;     // post-processing / screen-space shader passes
  readonly clock: { delta: number; elapsed: number };
}

export interface Plugin {
  readonly name: string;
  install(ctx: PluginContext): Promise<void> | void;  // add objects, register passes, subscribe
  update?(ctx: PluginContext): void;                   // per-frame, before render
  resize?(width: number, height: number): void;
  configChanged?(config: Readonly<Config>): void;      // e.g. debugMode toggled
  dispose?(): void;
}

// RenderPipeline wraps an EffectComposer; plugins add passes for custom shaders.
export interface RenderPipeline {
  addPass(pass: Pass): void;
  render(): void;                                       // composer.render() or renderer.render()
}
```

Built-ins become classes: `class AmbientLightPlugin implements Plugin { install(ctx){ ctx.scene.add(this.light) } dispose(){…} }`.
Shader extensibility = (a) **post-fx passes** via `ctx.pipeline.addPass` (EffectComposer), and (b) a
**material decorator hook** the world adapter accepts (`onBeforeCompile` injection) — added when needed.
The loop calls `update()` on each plugin, then `pipeline.render()`. (Improvement over the src2 sketch,
where plugins are bare functions and `render()` only does `controls.update()`.)

## Game singleton API

```ts
export class Game extends EventEmitter {
  static getInstance(canvas?: HTMLCanvasElement, config?: Config): Game; // create once, then accessor
  use(plugin: Plugin): this;                       // register before init
  setWorldAdapter(adapter: WorldAdapter): this;
  init(): Promise<void>;                            // renderer/scene/camera, install plugins, start loop
  loadGame(center: Vec3, opts?: LoadOptions): Promise<void>;   // adapter.prepare + seed view@center (StreamingSystem fills regions; camera fits/follows)
  setDebugMode(enabled: boolean): void;            // emits; plugins/overlay react
  setConfig(patch: Partial<Config>): void;
  refresh(): Promise<void>;                         // re-apply config-dependent setup / reload region
  dispose(): void;
}
```

`Game` **owns** renderer/scene/camera (created from a `<canvas>` — no R3F objects passed in, unlike
the sketch). Debug flow: Ctrl+D → `game.setDebugMode(true)`; panel changes → `game.setConfig({...})` +
`game.refresh()` (rebuild region); click → game raycast → `adapter.describe` → `events.emit('select', info)`
→ overlay shows. Progress events drive a **DOM preloader** (replaces `<Suspense>`/`useArchiveDownload`).

## Removing R3F (concrete replacements)

- `useLoader(DFF/TXD)` / `useModelParts` → `renderware/archive` `getClump`/`getTextures` (already sync) +
  `buildClumpParts`, cached by model key — called inside `buildRegion`.
- `useArchiveDownload`/`useGtaMap` (Suspense) → plain `Promise`s in `adapter.prepare`, awaited in `loadGame`.
- `model-instances.tsx` → imperative `buildRegion`: group instances by model key, create one
  `InstancedMesh` per render-part, set matrices (`compose(pos, quat.conjugate(), 1) × part.matrix`),
  stamp `userData = { def }` for click-inspect.
- `fit-camera.tsx` (`useFrame`) → `camera-controller.ts` (`fit-region` mode): frames the `view` after a
  region loads; later gains a `follow-entity` mode for the player.
- OrbitControls → a `ControlsPlugin` (three `examples/jsm` addon).
- `app.tsx`/`<Canvas>` → `ui/canvas-host.tsx` (canvas ref → `Game.getInstance(canvas,cfg).init()`).

## Dynamics is a committed roadmap — make the core ready from phase 2

Streaming + player movement are definitely coming, so the engine core is built **dynamics-ready** (not
retrofitted): the loop, the `System` registry, the fixed-step accumulator, the `view` focus, and the
camera-controller modes all exist from phase 2 with trivial implementations, so the systems below drop
in as added `System`s without touching the core. The static world stays instanced (no ECS); dynamics
run through ECS. Hybrid: `tick(dt)` → run ordered systems (fixed-step for physics/ECS) → plugin.update
→ `pipeline.render()`.

- **Streaming + LODs:** `game/streaming` `StreamingSystem` — a world grid/quadtree keyed on the **view**
  cell; on cell change it asks `WorldAdapter.loadRegion` for new cells and unloads far ones (add/remove
  InstancedMeshes). LOD vs full is chosen per-distance (today's `geometry:'map'|'lods'` generalizes).
  `loadGame(coords)` just seeds the `view` at `coords`.
- **Character + ECS (bitECS):** `game/ecs` — components (Transform, Velocity, ModelRef, Collider) +
  systems (CharacterController, RenderSync, …) registered in `core/system.ts`. The player entity drives
  the `view` (camera follows it; streaming centers on it).
- **Physics (Rapier):** `game/physics` `PhysicsSystem` on the fixed step; static colliders from COL,
  Rapier kinematic character controller for the player.
- **Collision (COL):** `renderware/parsers/col` → collision meshes; surfaced via the adapter
  (`loadColliders(region)`), consumed by `PhysicsSystem`.

## Phased migration (each phase keeps `npm test` + the app green)

> **Status (2026-06-05): phases 0–5 DONE — R3F fully removed, engine drives the render imperatively.**
> Only phase 6 (the future dynamics plans) remains. Phases 2–5 landed together once the Game core
> was wired (plugins, adapter seam, UI and dep removal were all in scope of the same pass).

0. ✅ **Scaffold + deps.** `game/` skeleton beside the working app; eslint `no-restricted-imports`
   boundary (game→renderware only via `game/adapters/**`).
1. ✅ **Consolidate `renderware`.** `gta-sa-parsers` → `renderware/parsers/{binary,text}`; archive/
   asset-cache/resolve-paths/model-key → `renderware/archive`; framework-agnostic `resolve-map` +
   `build-region` → `renderware/map`. Tests moved with files.
2. ✅ **Game core + drop R3F render.** `Game` owns renderer/scene/camera/loop + `CameraController`
   (bbox framing); `<Canvas>` → `ui/canvas-host.tsx`; deleted `map/*.tsx`, `app.tsx`, `components/debug`.
3. ✅ **Plugin system.** `Plugin`/`PluginContext`/`RenderPipeline`; lights are classes
   (`AmbientLightPlugin`/`DirectionalLightPlugin`). `BasicRenderPipeline` (EffectComposer slot left for later).
4. ✅ **Adapter seam.** `WorldAdapter` + `GtaSaWorldAdapter` (the only renderware importer); `loadGame`
   goes through it; lint boundary verified.
5. ✅ **API polish + UI.** `loadGame/setDebugMode/setConfig` + `pick`/`resize`; `ui/debug/debug-overlay`
   talks to `Game` via events; DOM preloader. `@react-three/fiber`/`@react-three/drei` removed.
6. **(Separate plans — NOT STARTED)** COL parser → streaming/LOD → bitECS entities/character → Rapier physics.

### Divergences from the plan as built (phases 2–5)

- **No `eventemitter3`.** `Game` does **not** extend an emitter; it composes a custom **typed** `EventBus`
  (`game.events.on/emit`, fully type-checked against `GameEvents`). Avoids an untyped string-event dep.
- **`use(plugin)` → `addPlugin(plugin)`** (lint `no-unnecessary-use-prefix` mistook `use` for a hook).
- **No `refresh()` method.** Region reload is just calling `loadGame(center, opts)` again (it disposes the
  previous region's geometry/materials — textures are shared/kept — then frames the new one).
- **No `ControlsPlugin`.** OrbitControls + camera framing are folded into `core/camera-controller.ts`
  (the loop calls `cameraController.update()` directly), so controls/camera stay one concern.
- **No separate `loop.ts`/`view.ts`/`resize.ts`/`raycast.ts`.** The fixed-step loop lives in `Game.start()`;
  `resize`/`pick` (raycast) are `Game` methods. `view`/streaming seams are deferred to phase 6.
- **No `public-api.ts`.** Methods on the `Game` singleton (per the resolved open decision below).

## Dependencies

- **Add:** `eventemitter3`. (three `OrbitControls`/`EffectComposer` already available via `three/addons`.)
- **Remove (phase 5):** `@react-three/fiber`, `@react-three/drei`. Keep `react`/`react-dom` (thin UI).
- **Later:** `bitecs`, `@dimforge/rapier3d-compat`.

## Testing

Pure parsers + `renderware/three` keep their node/vitest specs (move with files). Engine: unit-test
plugin lifecycle and `buildRegion`/`resolve-map`/`camera-fit` with a stub renderer/archive (no WebGL);
adapter tested against a stub archive. Full integration stays **Playwright** (archive download → render →
debug). Boundary correctness is a lint rule, not a runtime test.

## Open decisions (RESOLVED during impl)

- ✅ `renderware` is a **top-level sibling** of `game` (not nested). Revisit only if multiple games
  are wanted (`engines/<id>/`).
- ✅ **Methods on the `Game` singleton** (no separate `PublicApi` object).
- ✅ Static world stays **instanced/static (no ECS)**; ECS is reserved for dynamic entities (phase 6),
  to avoid per-instance overhead at SA scale (~36k static objects).
