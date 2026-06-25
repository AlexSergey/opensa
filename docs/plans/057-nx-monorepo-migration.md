# 057 — Nx monorepo migration

**Status: 📝 Proposed (design agreed).** Split the single `opensa` npm package into an **Nx** monorepo of
`apps/` (web + viewer), `packages/` (the engine libs), and `tools/` (the offline tools), turning today's deep
relative imports (`../../../../src/renderware/...`) into `@opensa/*` package imports with **enforced module
boundaries**. Expands `docs/ideas/monorepo-packages.md` (which is now promoted from "later, maybe" to this plan).

## Why Nx (vs Turborepo)

Both cache + orchestrate tasks. Nx wins **for us** on three concrete points: (1) **`@nx/enforce-module-boundaries`**
— tag-based lint rules (`type:app|engine|tool`, `scope:*`) make the dependency DAG (apps → packages →
renderware; tools read the engine read-only; engine never depends on tools) **CI-checkable automatically**,
replacing the hand-rolled `gameBoundaryConfig`; (2) **generators** (`nx g lib`) scaffold the many packages/tools
with tsconfig refs + configs; (3) **`nx affected` + `nx graph`** run/visualise only what changed. Cost: more
config/opinion than Turborepo's thin script wrapper. Adoptable incrementally — start with graph + cache +
boundaries, keep our Vite/Vitest/ESLint configs via inferred targets. Package manager: **pnpm workspaces**
recommended (`workspace:*`), npm workspaces also fine (Nx supports either).

## Target layout

```
apps/
  web/      ← src/ui + main.tsx + game-config + index.html  (+ controls-harness tab)
  viewer/   ← src/standalone/{object,vehicle,character}-viewer — tabs in ONE html
packages/   (tag type:engine)
  renderware/ · game-build/ · loaders/ · vfs/ · game/
tools/      (tag type:tool)
  rw-codec/ · tool-kit/ · map-optimizer/ · lod-generator/ · vehicle-optimizer/ · timecyc-builder/
root: game-src/ · tests/ · e2e/ · scripts/ · deploy/ · static/ · nx.json · configs
```

## Dependency DAG (derived from current imports)

```
renderware (leaf)
  ← game-build → renderware            [cycle with loaders broken — see below]
  ← loaders → renderware, game-build
  ← vfs → renderware, loaders
game → renderware                      (independent branch; loading injected by the app adapter)
apps/web    → game, loaders, renderware, vfs
apps/viewer → renderware, game
tools: tool-kit → renderware;  rw-codec → renderware
       map-optimizer/lod-generator/vehicle-optimizer/timecyc-builder → renderware, game-build, rw-codec, tool-kit
```

## Key facts that shape the work

- **The only cycle, `loaders ↔ game-build`, is thin.** `game-build/partition.ts` imports a single **type**
  `GroupName` from `loaders/types`; `loaders` uses `game-build/partition` heavily. Break it by moving `GroupName`
  into `game-build` (or a shared types module). Pure refactor, no layout change — do it **first**.
- **`map-optimizer` is a de-facto shared lib** (lod-generator imports it 9×, vehicle-optimizer 6×). The shared
  part is the **RW codec** (`codec/{chunk,dff,geometry-struct,dxt,texture-native}` + `lib/mip`). Extract it to
  **`tools/rw-codec`** (decided — its own package) so tools consume it instead of importing each other.
- **Tools import engine internals**, not a barrel (`renderware/parsers/binary/dff`, `archive/img-archive`,
  `test-utils`). So `@opensa/renderware` needs **subpath `exports`** (`./parsers/*`, `./archive/*`,
  `./test-utils`). Start broad, tighten the public surface later.
- **`test-utils` leaks into tool tests** — expose as `@opensa/renderware/test-utils` (or a tiny `@opensa/testing`).
- **Viewers → one `apps/viewer`** with object/vehicle/character as **tabs in a single html** (decided), not 4
  builds.
- **ui-kit deferred** (decided) — shared UI stays in `apps/<app>`. Wrinkle: `controls-harness` uses
  `TouchControls` (lives in `apps/web`). To avoid an app→app import, **keep `controls-harness` as a tab in
  `apps/web`** (not in `apps/viewer`).

## Docs move with their packages

Each subproject's `docs/` travels with the code: `map-optimizer/docs` → `tools/map-optimizer/docs`,
`vehicle-optimizer/docs` → `tools/vehicle-optimizer/docs`, `lod-generator/docs` → `tools/lod-generator/docs`
(and `tool-kit`/`timecyc-builder` docs if/when they exist). The new `docs/plans/README.md` index links all plan
sets across the repo; **update those links on each move** so the central docs stay the source of truth.

## Migration steps (each an independent green commit)

1. **Break the `loaders ↔ game-build` cycle** (move `GroupName`). No layout change. ✅ **Done** — `GroupName`
   now lives in `game-build/partition.ts`, re-exported from `loaders/types.ts`; game-build no longer imports
   loaders (consumers untouched). 983 tests green.
2. **Extract `rw-codec`** from map-optimizer → `tools/rw-codec`; repoint lod-generator + vehicle-optimizer.
   ✅ **Done** — pure codec (chunk, geometry-struct decode/encode, dff collectors, dxt±encode, texture-native,
   mip) now lives in top-level `rw-codec/`; the `SubMesh`/`MeshIR` glue (`encodeDff`, `applyMeshToStruct`,
   `rebuildGeometry`) stays in map-optimizer and imports it. lod-generator + vehicle-optimizer import rw-codec,
   not map-optimizer. Tests split (pure → rw-codec, glue → map-optimizer); 983 green. (Folder is top-level for
   now; physically lands under `tools/` in step 4.)

   > **Reorder (agreed):** Nx is moved to **last**. Its wins (boundaries + per-project cache) need the workspace
   > layout + **name-based imports** first — `@nx/enforce-module-boundaries` flags relative cross-project imports,
   > and tools' legit `src/renderware` imports can't be told from app imports while the engine lives in `src`. So:
   > workspaces + codemod → then Nx slots in cleanly.

3. **npm workspaces, package by package** (codemod folded in per package, leaf-first). Each package gets a
   `package.json` with subpath `exports` → `.ts` + a `workspaces` entry; importers move to `@opensa/<pkg>/<sub>`.
   ✅ **Pilot done — `@opensa/rw-codec`.** Validated that `@opensa/*` → `.ts` resolves across **tsc + vite +
   vitest + tsx** via the workspace symlink + `exports`, **no `tsconfig paths`, no build**. 983 green. Rollout
   order: `rw-codec` ✅ → `tool-kit` ✅ → engine packages from `src/` (`renderware` ✅ → `game-build` ✅ →
   `loaders` ✅ → `vfs` ✅ → `game` ✅) → CLI tools (`map-optimizer` ✅, `lod-generator` ✅,
   `vehicle-optimizer` ✅, `timecyc-builder` ✅) — import-leaves, given a trivial `package.json` (no `exports`,
   nothing to repoint). **All 11 `@opensa/*` packages now registered; `eslint .` + tsc + 983 tests green.**
   - **Engine ✅ done** — all 5 made in place (`package.json` + `@opensa` name + `exports`), the whole app + tools
     repointed to `@opensa/*`, intra-package imports left relative. Broad `exports` (`.` barrel where an index
     exists, `./*` → `./*.ts`, explicit dir-barrels: `renderware/archive`, `game/input`). tsc-checked per package;
     983 green, lint clean. Physical move to `packages/` is cosmetic + later.
4. **Move to `apps/`, `packages/`, `tools/`** (incl. each module's `docs/`) — physical relocation once each is a
   package (location is independent of the `@opensa` name, so imports don't change — only `workspaces` paths +
   configs/scripts/globs). Sub-steps by risk: **A — tools → `tools/`** ✅ (workspaces, `timecyc` script,
   vitest/eslint globs, `.gitignore`, doc links updated; symlinks repointed; 983 green). **B — engine → `packages/`**
   ✅ (`src/{renderware,game-build,loaders,vfs,game}` → `packages/`; workspaces + vitest test-include/coverage +
   eslint gameBoundary/check-file globs + scripts' relative engine imports updated; `src/` now app-only; 983
   green). **C — app → `apps/web` + `apps/viewer`** (next; the risky one: vite/html/e2e wiring).
5. **Apps**: split Vite into `apps/web` + `apps/viewer` (object/vehicle/character tabs in one html;
   controls-harness stays in `apps/web`).
6. **Stand up Nx** over the finished workspaces. ✅ **Done** — nx 23 + `@nx/eslint-plugin`; `nx.json`; 12 projects
   (the app added as `@opensa/web` via `src/package.json`); tags `type:app|engine|tool`;
   `@nx/enforce-module-boundaries` live (app→engine, engine→engine only, tool→engine+tool) — **proven to catch a
   deliberate engine→tool violation**, deep subpath imports allowed (respects `exports`). `.nx/` cache ignored.
   `nx show projects` graph works; 983 tests + tsc + eslint green. **Follow-up:** per-project cache/`affected`
   targets (our root vitest/eslint/build scripts make Nx cache one big task for now — define per-project targets
   to unlock granular cache/`affected`).
7. **Fix doc links** (`docs/plans/README.md` + cross-refs) after the moves; verify `tsc` + tests + lint + e2e
   green across all projects.

## Risks

- Large mechanical import rewrite — drive with a codemod, leaf-first; keep CI green per step.
- Engine packages' public surface (tools use internals) — broad subpath exports first, then curate.
- Extracting `rw-codec` without regressing map-optimizer's plan-010/015 tests.
- Vite multi-page → per-app; re-check `OPENSA_NO_VIEWERS` / prod build flags.

## Related

- `docs/ideas/monorepo-packages.md` — the original idea (now this plan).
- `docs/plans/README.md` — the cross-repo plan index (engine + per-tool).
