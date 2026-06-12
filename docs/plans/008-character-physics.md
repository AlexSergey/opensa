# 008 — First character: bitECS + Rapier physics, gravity, collision, follow camera

## Goal

Spawn the first **player character** on the parking lot in front of CJ's house (Ganton), give it a basic
physics body (**gravity + collision** against the real map COL), attach the **camera** to it, and let the
player **drive it with the keyboard** when the game is in **play** mode and the character is grounded. This
is the first real test of the COL collision from plan 007, and the first slice of **dynamics** — wired
through **bitECS** (entities/components/systems) + **Rapier** (physics), the stack the engine was designed
around (plan 006).

The character is **temporarily a cube** loaded from `static/player/player.3ds` (a 237-byte 3ds cube the user
added). It will later be swapped for a real DFF character model — keep the player-model load behind a small
seam. See memory [[player-cube-placeholder]].

## Coordinate system (the key decision — read first)

The engine world is **GTA Z-up**; the `−90°X` rotation is **display only**.

- **Physics + ECS run in GTA Z-up.** Rapier gravity = `(0, 0, -9.81)`. The player falls along **−Z**.
- **Static colliders** come straight from `CollisionWorld` (plan 007): COL vertices are model-space Z-up,
  placements are Z-up `Matrix4`. Each placement → a **fixed** Rapier body at the decomposed
  translation+quaternion, with the model-space shape attached. **No `−90°X` baking** (corrects the earlier
  plan-007 note).
- **Render alignment:** the player's `Object3D` goes under an **`entityRoot`** group (`rotation.x = −π/2`),
  a sibling of the region's existing `−90°X` group — both share the same constant rotation, so a player at
  Z-up `(2495, -1687, z)` lines up exactly with the region geometry there. The region/adapter render path is
  **untouched** (no double-rotation risk).
- **Camera follow** reads `player.getWorldPosition()` — already Y-up scene space (the `entityRoot` rotation
  is baked into the world matrix) — so the camera math needs no manual conversion.

## Dependencies (new)

- **`@dimforge/rapier3d-compat`** — Rapier 3D physics as WASM. The `-compat` build needs an explicit
  `await RAPIER.init()` (no top-level await / bundler WASM config). One-time init before the physics world.
- **`bitecs`** — ECS. (API differs across versions — match the installed one; classic API used below:
  `createWorld`, `defineComponent`, `addEntity`, `addComponent`, `defineQuery`. Verify on install.)

`three/addons/loaders/TDSLoader.js` already ships with `three` (no new dep) for the temporary cube.

## Module structure (new, under the generic `game` layer)

```
src/game/
  ecs/
    world.ts            # createEcsWorld(); shared bitECS world handle
    components.ts       # Transform (x,y,z, qx,qy,qz,qw), Velocity, PlayerControlled (tag), RigidBody (handle)
    queries.ts          # defineQuery wrappers (players, renderables, bodies)
  physics/
    rapier.ts           # initRapier(): Promise<typeof RAPIER>; lazy WASM init, cached
    physics-world.ts    # PhysicsWorld: wraps RAPIER.World (gravity -Z), createStaticColliders(CollisionWorld),
                        #   createCharacterBody(spawn) -> handle, step(dt), readBody(handle) -> {pos, quat}, isGrounded
    physics.system.ts   # PhysicsSystem (System.fixedUpdate): step world, body transforms -> Transform component
  character/
    load-player.ts      # loadPlayerMesh(url): Promise<Object3D> via TDSLoader (the swap-to-DFF seam)
    character-controller.system.ts  # reads input + grounded -> sets player body velocity/impulse (play mode only)
    render-sync.system.ts           # Transform component -> player Object3D local transform
  input/
    keyboard.ts         # Keyboard: window keydown/keyup -> Set<code>; isDown(action) via Config.controls keymap
  core/
    camera-controller.ts# + follow(target: Object3D) / setMode('orbit' | 'follow'); follow trails + lookAt
  interfaces/
    config.interface.ts # + gameState: 'play' | 'pause'; + controls: ControlsConfig keymap
```

`game` may use `three/addons` (generic three), `bitecs`, `@dimforge/rapier3d-compat` — none are renderware,
so the game↔renderware boundary is unaffected. The player model load (`load-player.ts`) is the seam that
later becomes a renderware DFF via the adapter.

## Config additions

```ts
type GameState = 'pause' | 'play';

interface ControlsConfig {            // remappable; values are KeyboardEvent.code
  back: string;    // 'KeyS'
  forward: string; // 'KeyW'
  jump: string;    // 'Space'
  left: string;    // 'KeyA'
  right: string;   // 'KeyD'
}

interface Config {
  // ...existing (debugMode, showCollision, staticUrl)
  controls: ControlsConfig;
  gameState: GameState;               // default 'pause'
}
```

`Game.setGameState('play' | 'pause')`: in **play** the PhysicsSystem steps, input drives the character, the
camera follows; in **pause** physics is frozen, input ignored, the camera returns to free orbit.

## Engine wiring

- `Game.addSystem(system: System): this` — expose the existing `SystemRegistry.add` so physics/ECS/character
  systems register. The loop already runs `systems.fixedUpdate(step)` then `systems.update(delta)`.
- `Game.entityRoot` — a persistent `Group` (`rotation.x = −π/2`) added to the scene in `init`, parent of
  dynamic entity meshes (the player now; NPCs/vehicles later).
- A `setupCharacter(...)`/`spawnPlayer(...)` orchestration (called from the canvas-host bootstrap after
  `loadGame`): init Rapier → build static colliders from `game.loadColliders()` → load player mesh → create
  entity + body → register systems → set camera follow target. GTA-specific bits (spawn coords, model url)
  live in the bootstrap; the systems/components stay generic.
- Spawn point: just above CJ's parking lot — start from `GANTON_CJ_HOME` `(2495, -1687, 13)` with `z`
  raised a few metres so the cube drops onto the surface; tune during impl.

## Iterations (each keeps `npm test` + the app green; ✅ when done)

> Small, independently shippable steps. Visual/browser acceptance is called out where it's the real check.

**0. Deps + seams (no behaviour). — ✅ DONE.**
- Installed `@dimforge/rapier3d-compat@0.19.3` + `bitecs@0.4.0`. **Note: bitecs 0.4 is the new functional
  API** (not classic 0.3 `defineComponent`/`defineQuery`) — iteration 2 must match it.
- `physics/rapier.ts` `initRapier()` (cached WASM init) + test. **Rapier WASM initialises fine in
  vitest/node** → no `skipIf` needed; physics can be unit-tested headless after all.
- `Game.addSystem(system)` (exposes `SystemRegistry.add`); `Game.entityRoot` Group (`−π/2` X, display-only)
  created eagerly + scene-added in `init`; `Game.getEntityRoot()` accessor.
- 129 tests green; tsc + eslint + `vite build` clean. *Acceptance:* entityRoot is empty → Ganton renders
  unchanged (verified via build; no behaviour change).

**1. Player cube on the lot (static, no physics). — ✅ DONE (code); browser acceptance pending.**
- `character/load-player.ts` `loadPlayerMesh(url)` (TDSLoader, forces a bright placeholder material).
  `CameraController.focus(target, distance)`; `Game.frameEntity(object)`. `PLAYER_SPAWN = [2495,-1687,16]`.
  Bootstrap loads the cube after `loadGame`, adds it under `entityRoot` at the spawn, frames it.
- 129 tests green; tsc + eslint + build clean. *Acceptance (browser): ✅ confirmed* — orange cube on CJ's lot,
  camera holds on it. Tuned: `frameEntity` default distance → **20**, player `scale 0.8`. The cube **floats**
  (no physics yet) — expected; iterations 3–4 land it. Exact lot-centring deferred (debug-click reads coords);
  not critical as long as collision sits under the spawn. Also fixed a **StrictMode** bug: the debug-overlay
  region-reload effect used a "skip first run" ref that mis-fired on StrictMode's double-invoked effects and
  clobbered the camera framing — replaced with an applied-modes compare (`appliedModesRef`).

**2. bitECS world + Transform + render sync. — ✅ DONE.**
- `ecs/world.ts` (`createEcsWorld`/`EcsWorld`), `ecs/components.ts` (`Transform` SoA + `PlayerControlled` tag).
  `character/render-sync.system.ts` (`RenderSyncSystem`: `Transform` → player `Object3D`, Z-up local, per
  frame). `character/setup-character.ts` (`setupCharacter(game, player, spawn)` → `CharacterContext`
  `{ world, playerEid, renderRefs }`; one immediate `update()` so the camera frame is correct). Bootstrap
  drives the cube via ECS. `queries.ts` deferred to iteration 5 (no consumer yet).
- 131 tests green (render-sync mapping + skip-no-ref); tsc + eslint + build clean. *Acceptance:* visually
  identical to iter 1 (static cube), now ECS-driven — the pipeline is the proof, not a new visual.

**3. Rapier world + gravity (temp ground). — ✅ DONE (code); browser acceptance pending.**
- `physics/physics-world.ts` `PhysicsWorld` (`RAPIER.World`, gravity −Z; `createBox`/`createStaticBox`/
  `step`/`readBody`/`dispose`). `physics/physics.system.ts` `PhysicsSystem` (`fixedUpdate`: step →
  body→`Transform` over `[RigidBody, Transform]`). `RigidBody { handle }` component. `setupCharacter` now
  **async**: builds the Rapier world, a temp static ground (centre z 12.5), a dynamic player box **sized from
  the mesh bbox**, registers physics + render-sync. Cube falls on load.
- 134 tests green (headless Rapier: box drops & settles at z≈1.0 on a ground; falls in one step; system
  writes body→Transform); tsc + eslint + build clean. *Acceptance (browser):* cube drops from z16 and rests
  on the temp ground (≈ lot height). **Note:** temp ground is arbitrary (~z13), so resting height is
  approximate — iteration 4's real colliders fix it. Physics runs always (no play/pause until iter 5).

**4. Real map collision. — ✅ DONE (code); browser acceptance pending.**
- `PhysicsWorld.createStaticColliders(models)`: one fixed body per placement (translation+rotation from
  `Matrix4.decompose`, Z-up) with trimesh → `ColliderDesc.trimesh`, boxes → `cuboid` (local centre), spheres
  → `ball`; degenerate trimeshes / zero boxes skipped; split into `addShapes`/`addTrimesh`/`addBox`/`addSphere`
  helpers (complexity). `setupCharacter` now `await game.loadColliders()` + `createStaticColliders(...)`
  instead of the temp ground.
- 138 tests green (count: empty→0, no-shapes→0, tri+box+sphere×2→6, box-only→1); tsc + eslint + build clean.
  *Acceptance (browser):* cube lands on the real lot COL; Show Collision overlays the resting surface.
  **Watch:** fall-through (no COL under spawn) and load time (colliders built for the whole Ganton radius —
  may need a smaller physics radius if slow).

**5. Play/pause + keyboard control. — ✅ DONE (code); browser acceptance pending.**
- Config `gameState` (default **pause**) + `controls` (WASD+Space). `input/keyboard.ts` (`Keyboard` window
  listeners + `KeyboardInput` stub seam). `Game.setGameState` (+ `game-state` event) + `Game.getConfig()`
  (live config for systems). `PhysicsSystem` steps only while playing. `CharacterControllerSystem`: in
  play + **grounded** (downward `castRay` excluding own body), WASD → planar velocity, Space → jump; in air
  keeps momentum. Player uses `createCharacterBody` (rotations locked, friction). Systems order: controller →
  physics → render-sync. Debug overlay **GAME: Play/Pause** (pulled from iter 7).
- 143 tests green (pause no-step; play writes; forward→+Y; stop on no keys; jump→+Z; pause ignores input);
  tsc + eslint + build clean. *Acceptance (browser):* on load the cube is **frozen** (pause); Ctrl+D →
  GAME: Play drops it; WASD drives it (grounded), Space jumps; Pause freezes. **Note:** movement is
  **world-axis** (W=+Y), not camera-relative — camera-relative steering can ride on iter 6's follow camera.

**6. Follow camera + camera-relative movement. — ✅ DONE (code); browser acceptance pending.**
- `CameraController.follow(target)` translates the camera by the player's movement (preserving the orbit
  offset) and re-centres OrbitControls on it (mouse still orbits/zooms around the player). `Game`:
  `getCamera()`, `setFollowTarget()`; the loop runs `follow` in play (else free orbit). **Movement is now
  camera-relative** — the controller reads `camera.getWorldDirection()`, projects to the ground and converts
  scene Y-up → GTA Z-up `(x,y,z)→(x,−z,0)` (right = forward × up); W goes where the camera looks. Diagonals
  normalised. `setupCharacter` wires the camera in + `setFollowTarget(player)`.
- 143 tests green (controller tests pass a default camera: −Z look → +Y forward); tsc + eslint + build clean.
  *Acceptance (browser):* in play the camera trails the cube, mouse orbits around it, W follows the view;
  pause → free orbit.

**7. Camera modes + polish. — ✅ DONE (code); browser acceptance pending.**
- Reworked `CameraController` into two modes (user request): **follow** (play) orbits the player on plain
  `pointermove` (no button held), clamped to a hemisphere above it (`followMin/MaxPolar` — never below the
  floor), wheel zoom optional (`followZoom`), distance from `Config.camera`; **debug** (Ctrl+D) detaches
  top-down over the district (`DEBUG_HEIGHT`), OrbitControls with rotate off, **drag (held button) pans X/Y**,
  wheel dollies down (`screenSpacePanning=false`). New `Config.camera` (`followDistance`/`followMinPolar`/
  `followMaxPolar`/`followZoom`). `Game.setDebugMode` switches camera mode; `setFollowTarget`→`setTarget`;
  loop simplified to `cameraController.update()`; `dispose` removes the mouse listeners.
- PLAY/PAUSE toggle already in the debug overlay (iter 5). 143 tests green; tsc + eslint + build clean.
  *Acceptance (browser):* play = mouse-look around the cube (hemisphere) + zoom + camera-relative W; Ctrl+D =
  top-down district view, drag-pan + scroll-down. **Optional remaining:** dispose of Rapier/keyboard/ECS on
  `Game.dispose` (singleton lives for the page, so low priority); respawn button; debug region-frame buttons
  are angled, not top-down (minor).

## Testing strategy

- **Unit (vitest, node):** ECS component read/write + queries; render-sync mapping; keyboard action mapping;
  character-controller velocity from stubbed input/grounded; `createStaticColliders` counts from a stub
  `CollisionWorld`; `PhysicsWorld` gravity/settle (headless Rapier, `skipIf` if WASM unavailable in CI).
- **Browser acceptance** is the real check for spawn alignment, falling/landing, driving, and follow camera —
  the engine renders imperatively (no R3F), so these are manual/Playwright steps per iteration above.
- Keep the boundary lint (`game/**` may not import renderware except adapters) green throughout.

## Risks / decisions

- ✅ **DECIDED — physics model: dynamic box body.** Gravity + collision + rest + velocity-driven movement;
  simplest path to the first falling/landing cube. Rapier's `KinematicCharacterController` (slopes/steps/
  auto-step) is an explicit later refinement — do **not** block the first test on it.
- ✅ **DECIDED — Rapier WASM in tests.** Verified in iteration 0: `@dimforge/rapier3d-compat` **initialises
  fine in vitest/node**, so physics IS unit-testable headless (no `skipIf` needed). Browser acceptance still
  the real check for falling/landing/driving, but headless `PhysicsWorld` step/settle tests are viable.
- **Grounded detection.** Downward ray from the body vs contact query — pick the simpler that works; needed
  for "can only steer while touching the ground".
- **`bitecs` API/version drift.** Pin and code to the installed version; the classic API above is the
  reference, not a guarantee.
- **Region vs collision extent.** Colliders are built for the loaded region (Ganton radius). Keep the player
  within it for the first test; streaming colliders is plan-006-phase-6 territory.
- **Player model seam.** `loadPlayerMesh` (3ds cube) is temporary; later a renderware DFF via the adapter —
  keep the call site model-agnostic. See [[player-cube-placeholder]].

## Out of scope (later)

Animation/skinning, proper character controller (slopes/steps/auto-jump), multiple NPCs/vehicles, ragdoll,
networking, collision **streaming** by region, swapping the cube for a real CJ DFF.
```
