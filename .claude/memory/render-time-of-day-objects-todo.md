---
name: render-time-of-day-objects-todo
description: TODO — render GTA SA time-of-day (tobj) objects with day/night gating
metadata:
  type: project
---

**TODO (deferred, user-requested split).** GTA SA `tobj` (time-of-day) IDE objects — neon, street lights, lit signs (~148 unique placements) — are a **distinct kind** that should only appear during a time-of-day window. They must **not** be mixed into the normal render catalog.

**Current state:** `parseTimedObjects` parses the IDE `tobj` section into `MapDefinitions.timedCatalog` (an optional `Map<id, IdeObjectDef>`, separate from `catalog`). They are parsed and kept but **not rendered yet** — `buildWorldGrid`/`buildCell` only read `catalog`, so `tobj` placements currently render nothing (no holes-as-bug; intentional gap). Each `tobj` row carries `timeOn,timeOff` (stripped during parse — would need to be retained when we implement gating).

**Why:** the user said `tobj` is a separate kind, not to be rendered alongside ordinary `objs`/`anim` geometry. Render it later with proper day/night logic.

**How to apply (later):** thread `timedCatalog` (or a parallel grid) into the streaming/render path, gated on an in-game time-of-day; retain `timeOn`/`timeOff` in `IdeObjectDef` (currently dropped). The placements that target `tobj` ids are already in `defs.instances` — they just resolve against `timedCatalog` instead of `catalog`. See [[binary-ipl-render-approach]] (map coverage section).
