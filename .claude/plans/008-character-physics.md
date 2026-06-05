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

**0. Deps + seams (no behaviour).**
- Add `@dimforge/rapier3d-compat` + `bitecs`. `physics/rapier.ts` `initRapier()` (cached WASM init).
- `Game.addSystem()`; `Game.entityRoot` group created in `init` and scene-added.
- *Tests:* `initRapier()` resolves and exposes `World` (node/vitest; `skipIf` if WASM won't load there).
  *Acceptance:* app still renders Ganton unchanged.

**1. Player cube on the lot (static, no physics).**
- `character/load-player.ts` `loadPlayerMesh(url)` (TDSLoader). Bootstrap loads it, adds it under
  `entityRoot` at the spawn coords (Z-up). Camera frames it once.
- *Acceptance (browser):* the cube sits on/above CJ's parking lot, aligned with the world.

**2. bitECS world + Transform + render sync.**
- `ecs/world.ts`, `ecs/components.ts` (`Transform`, `PlayerControlled`), `ecs/queries.ts`. Create the player
  entity; `render-sync.system.ts` copies `Transform` → the player `Object3D` (Z-up local). `Game.addSystem`.
- Drive the cube's position from the ECS `Transform` (still static values).
- *Tests:* component read/write; render-sync maps `Transform` → object position/quaternion (stub Object3D).

**3. Rapier world + gravity (temp ground).**
- `physics/physics-world.ts` (`RAPIER.World`, gravity −Z) + `physics/physics.system.ts` (`fixedUpdate`:
  `step` → body transform → `Transform`). Dynamic **box** body for the player + a temporary large static
  ground plane at the lot height. Cube falls and rests.
- *Tests:* `PhysicsWorld` steps a body under gravity and it settles on a ground collider (headless Rapier).
  *Acceptance (browser):* cube drops and lands on the temp ground.

**4. Real map collision.**
- Build Rapier **static** colliders from `game.loadColliders()` (`CollisionWorld`): trimesh →
  `ColliderDesc.trimesh(vertices, indices)`, boxes → `cuboid`, spheres → `ball`, one fixed body per
  placement at the decomposed Z-up transform. Replace the temp ground.
- *Tests:* `createStaticColliders` makes the expected collider count from a stub `CollisionWorld`.
  *Acceptance (browser):* cube lands on the actual parking-lot/ground COL (toggle Show Collision to compare).

**5. Play/pause + keyboard control.**
- Config `gameState` + `controls`; `input/keyboard.ts` (window listeners → action map). `Game.setGameState`.
  `character/character-controller.system.ts`: in **play** + grounded, WASD sets planar velocity, jump on
  ground; **pause** freezes physics + ignores input. Grounded via Rapier (downward ray / contact).
- *Tests:* keyboard maps codes→actions via `Config.controls`; controller produces expected velocity from a
  stub input + grounded flag. *Acceptance (browser):* in play, drive the cube around the lot; pause stops it.

**6. Follow camera.**
- `CameraController.follow(target)` / `setMode`. Play → camera trails the player (offset + lookAt, OrbitControls
  off); pause → free orbit. `Game` switches mode with `gameState`.
- *Acceptance (browser):* camera stays behind/above the moving cube in play; orbits freely in pause.

**7. UI + polish.**
- Debug overlay (or a small control) **PLAY / PAUSE** toggle → `game.setGameState`. Optional: re-spawn,
  show grounded/velocity. Tidy disposal (Rapier world, bodies, ECS, listeners) on `Game.dispose`.
- *Acceptance (browser):* full loop — load Ganton, press Play, cube falls onto the lot, drive it, Pause.

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
- ✅ **DECIDED — Rapier WASM in tests: `skipIf` + browser.** Guard physics unit tests with `skipIf` if the
  `-compat` WASM won't init under node/vitest (mirrors the real-archive `skipIf` pattern); the real check for
  falling/landing/driving is **browser acceptance**. Don't sink time forcing Rapier into node.
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
