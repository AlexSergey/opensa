---
name: test-fixtures
description: Tests read fixtures from tests/original (gitignored, regenerated via `npm run test:fixtures`) + tests/custom (committed mods/curated), NOT static/
metadata:
  type: feedback
---

**Tests must NOT read from `static/`** — that's the live game-data folder the user edits/swaps, so a static
change silently breaks tests (this caused a flaky timecyc byte-comparison failure). Copy whatever a test needs
into the repo-root **`tests/`** folder (committed) and read from there.

**Why:** deterministic, self-contained tests; decoupled from the mutable `static/` content.

**How to apply** (2026-06-19, licensing cleanup): fixtures split by provenance.

- **`tests/original/`** — real Rockstar assets, **gitignored**, regenerated locally by `npm run test:fixtures`
  (`scripts/test-fixtures.ts`): copies loose data + extracts IMG entries from `game-src/non-modified` (a clean
  STOCK SA copy), builds `img/admiral.img`, and generates `data/timecyc_24h.dat` = stock `convertTo24h` (no
  RealVision; the game's `npm run timecyc` keeps its own enhanced merge). Add new real fixtures to the MANIFEST.
- **`tests/custom/`** — committed (NOT Rockstar IP, or can't be reproduced from stock): mods
  (`dff/vehicle/comet.dff`, `petro-4/6wheels.dff`, `dff/uv-anim/visagesign04.dff`, `world/Lae2_roads03.dff`,
  `txd/yosemite.txd`) and `proper-fixes-models/` (curated/version-pinned test models: `casroyale02_lvs.dff`,
  `trafficlight1.dff`, `se_bit_17.dff`, `vegasnroad19.dff`).

Read via `join(process.cwd(), 'tests', 'original'|'custom', ...)` or `'tests/original/...'` / `'tests/custom/...'`.
CI tests are disabled for now (CI lacks game-src); run `npm run test:fixtures && npm test` locally.

**Still on `static/` (impractical to copy, kept `skipIf`-gated):** `col.test` (`static/models/gta3.img` is
**758 MB**); `ipl.parser.test` / `ide.parser.test` (resolve the _whole_ gta.dat map → many referenced IPL/IDE
files). Don't copy these. Related: [[timecyc]].
