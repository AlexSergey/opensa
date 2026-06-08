---
name: test-fixtures
description: Tests read asset fixtures from tests/ (root), NOT static/ — static is the live game data the user mutates
metadata:
  type: feedback
---

**Tests must NOT read from `static/`** — that's the live game-data folder the user edits/swaps, so a static
change silently breaks tests (this caused a flaky timecyc byte-comparison failure). Copy whatever a test needs
into the repo-root **`tests/`** folder (committed) and read from there.

**Why:** deterministic, self-contained tests; decoupled from the mutable `static/` content.

**How to apply:** put fixtures under `tests/<mirrored-path>` (e.g. `tests/data/timecyc.dat`,
`tests/vehicles/admiral.dff`, `tests/ipl_binary/...`) and read via `join(process.cwd(), 'tests', ...)` or
`'tests/...'`. Already moved (2026-06-08): timecyc.dat/timecyc_24h.dat, carcols.dat, handling.cfg,
vehicles.ide, gta.dat, lae_stream0.ipl, admiral.dff — used by timecyc(.parser).test, carcols/handling/
vehicle-defs/ipl-binary/gta-dat parser tests, dff.test (admiral reflection plugins). Existing convention:
`tests/renderware/testground.dff|txd` (not committed → those `skipIf` skip).

**Still on `static/` (impractical to copy, kept `skipIf`-gated):** `col.test` (`static/models/gta3.img` is
**758 MB**); `ipl.parser.test` / `ide.parser.test` (resolve the *whole* gta.dat map → many referenced IPL/IDE
files). Don't copy these. Related: [[timecyc]].
