# 013 — Synthesize night vertex colours for night-less models

**Status: ✅ Implemented** (`plugins/synthesize-night.ts` + `codec/geometry-rebuild.ts:addNightColorsIfMissing`,
in the default pipeline). On stock `original` it round-trips cleanly (0 failures) and, e.g., gives all four
`casroyale*_lvs` casino pieces the night set they lost on re-export.

## Context / problem

The SA map is **prelit** and the engine (plan 038, `world-material.ts`) lights a model two ways:

- **has a night set** → at night it blends `mix(day, night, dnBalance)` under `worldDayTintUniform`, which
  **relaxes to white** at night — the night set _is_ the night picture, so it isn't darkened further.
- **no night set** → it takes `day prelit × worldTintUniform`, and the world tint **sinks into the dark night
  ambient** — so the model is multiplied down toward black at night, even if its day prelit is perfectly fine.

So a night-less building looks correct by day and goes dark at night. The trigger case: `casroyale02_lvs`
(day prelit mean ≈ 50, `night: null`) — one of the `casroyale*_lvs` dirty re-exports already flagged at
`build-clump.ts:456` (their normals come in zeroed too). 240/250 of the surrounding LV building models _do_
carry night colours; these four are the outliers that lost theirs.

## Decision

Synthesize the missing night set from the day prelit so the model flips onto the non-darkening night path.
Map-wide, default-on heuristic (chosen over a targeted allowlist), with conservative guards:

- **Only models with day prelit but no night set.** Existing night sets are left byte-for-byte.
- **Skip dark-by-day models** (`mean luma ≤ minLuma`, default 32) — they're meant to be dark.
- **Skip overloaded day-prelit alpha** (any alpha < 255: wind sway / floodlight cones) — those aren't plain
  opaque surfaces, and we don't want bright trees/beams at night.
- **night := day prelit × `nightScale`** (fn default 1 = verbatim; the **pipeline configures `0.7`** after an
  in-game pass — keeps night-lit buildings a touch dimmer than their day look), alpha forced to 255 (the engine
  ignores night alpha).

## Module changes

- **`plugins/synthesize-night.ts`** (new): pure `synthesizeNight(prelit, opts)` + `createSynthesizeNight()`
  factory. Runs **last** in the default pipeline (after `condition-prelit`), so the night set is derived from
  the final, conditioned day prelit.
- **`codec/geometry-rebuild.ts`**: `addNightColorsIfMissing(geometry, mesh)` — inserts a `NIGHT_VERTEX_COLORS`
  chunk (`present=1` + RGBA) into the EXTENSION when one is absent (creating the EXTENSION if needed). No-op
  when a night chunk already exists (keeps those models byte-faithful). The chunk codec recomputes all
  container sizes on write.
- **`codec/dff.ts`**: calls `addNightColorsIfMissing` after the attribute-only / rebuild step, both paths.

## Risks / testing

- **Map-wide appearance change, can't be auto-verified here** — the real gate is **in-game**: night-less
  buildings will now hold their daytime look at night instead of darkening. Tune `minLuma` / `nightScale` (or
  scope to an allowlist via the plugin options) if the global night mood flattens too much.
- Unit tests: the pure `synthesizeNight` (dark→null, overloaded-alpha→null, verbatim copy, scaled copy) and
  the codec `addNightColorsIfMissing` (no-op without a synthesized set, leaves an existing chunk untouched,
  appends a round-tripping chunk). Real-run: `casroyale*_lvs` gain `night=Y` in the output build, 0 failures.
- Determinism: pure, no RNG.
