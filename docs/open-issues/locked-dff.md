# "Locked" (anti-rip protected) DFF models

**Status: shelved.** Investigated thoroughly; full support not attempted by request — recorded for
later. The **spawn crash is fixed** (a no-COL / locked vehicle now falls back to a box chassis instead
of throwing), but locked models still render incomplete or invisible.

Two distinct lock variants found so far — both falsify chunk-container metadata so a boundary-respecting
parser (ours) chokes while RenderWare's count-based reader keeps going:

| Variant                  | Example                    | Tamper                                                                | Recoverable?                                            |
| ------------------------ | -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| A — inflated counts      | `yosemite.dff` (Ford F350) | clump/GeometryList struct **counts** declare more children than exist | **No** — data genuinely absent                          |
| B — inflated struct size | `cheetah.dff`              | the clump **Struct chunk size** is bloated to swallow all siblings    | **Yes** — data is present, hidden behind the bogus size |

Both live in `game-src/original-extend/vehicles/`. (The companion `yosemite.txd` had a separate,
already-fixed issue — a leading empty chunk; see [plan 043](../plans/043-dff-txd-completeness.md).)

## How RenderWare reads DFFs (why the locks target our parser)

`RpClumpStreamRead` (mirror: **librw**, OpenRW) reads a fixed **count** of children via
`RwStreamFindChunk`, scanning the flat stream forward and **ignoring parent chunk size boundaries**;
and it reads a struct's fixed fields (e.g. `numAtomics/numLights/numCameras`) **directly**, never
trusting the struct chunk's declared size to skip. Our parser instead walks children **strictly within**
each parent's declared `[start, end)` (`forEachChild`) — which both locks exploit.

## Variant A — inflated counts (`yosemite.dff`)

The struct headers declare more children than the stream contains, and atomics index geometries that
don't exist.

|            | Declared in struct | Physically present                                            |
| ---------- | ------------------ | ------------------------------------------------------------- |
| Geometries | 31                 | 16 (each individually valid: geom#0 = 1790 tris / 1716 verts) |
| Atomics    | 31                 | 8                                                             |

- The 8 atomics reference geometry indices `0, 2, 6, 10, 14, 19, 23, 27` — up to **27, out of range**
  for a 16-geometry list.
- All chunk **sizes are self-consistent** (the GeometryList ends exactly where the atomics begin, the
  clump ends exactly on its last extension) — not parser drift; the file declares more than it holds.
- The missing 15 geometries (~100–450 KB each) are **not in the file** (the 2.8 KB tail after the clump
  can't hold them).

Simulating RW's count-based reading:

```
declared geom 31 -> RW-style found 16 (then hit EOF)
declared atomics 31 -> RW-style found 0   (the geometry scan already ran to EOF)
```

So **even a faithful RW reader fails here** — it finds 16 geometries, runs off the end hunting for the
17th, never reaches the atomics. A vanilla SA + RW pipeline wouldn't load it either (it would need an
unlocker ASI). We can't render geometries that aren't in the stream.

## Variant B — inflated struct size (`cheetah.dff`)

Here the data is all present, but the **clump's first child (the Struct, `0x01`) declares size
`16777228` (`0x0100000C`)** instead of the real **`12` (`0x0C`)** — the high byte is tampered to
`0x01`. Our `forEachChild` trusts that size and seeks ~16 MB past the struct, so it sees **only the
struct** and misses the FrameList, GeometryList, all 57 atomics, and the Extension holding the `COL3`
chunk (present at offset 11889056). Result:

- `parseDff(cheetah.dff)` → **0 frames / 0 atomics / 0 geometries** (empty model).
- `parseDffCollision` → `null` (the COL is inside the missed Extension).

RenderWare survives because it reads the clump struct's fixed fields directly and **ignores the bogus
size**, then finds each following chunk by scanning — so the game loads it. Unlike Variant A, the data
is **recoverable** by an RW-faithful reader.

## What is fixed vs. what remains

- **Fixed — spawn no longer crashes (`physics-world.ts`).** Previously a locked/no-COL vehicle reached
  the chassis fallback with empty vertices; `ColliderDesc.convexHull(empty)` returns a **non-null but
  invalid** desc, so the `?? boxHull` guard never fired and `createCollider` threw _"expected instance
  of OA"_. `addConvexChassis` now only attempts the hull with enough points, wraps it in try/catch, and
  box-falls-back to the car's `halfExtents` (default `[1.2, 2.5, 0.7]`). This is a general robustness
  win for **any** vehicle with no usable COL, not just locked ones. Tests in `physics-world.test.ts`.
- **Still broken — locked models don't render.** Variant A spawns a partial model; Variant B spawns an
  **empty** group (the same lock also hides its frames/geometries/atomics from `parseDff`) + a box
  collider. Making them render is the open work below.

## Options (when we return)

1. **Treat it as an asset problem (recommended, both variants).** Un-lock / re-save the model in a clean
   RW tool (a DFF unlocker, or open+resave via a sane exporter) so counts + layout become standard; then
   our parser — and any RW reader — handle it.
2. **RW-faithful parsing for Variant B (medium risk, recovers cheetah-type locks).** Read clump /
   geometry-list Struct fixed fields and ignore the declared size (or clamp a child's `end` to the
   parent's `end`, or walk by count like RW). Recovers files whose data is present but hidden behind a
   bloated struct size. Touches the **core DFF read path every model uses** → real regression surface;
   needs the count-based approach + careful fixtures. Does nothing for Variant A.
3. **Detect + report locked DFFs (low risk, optional).** Flag a declared-vs-present mismatch and surface
   a clear message (e.g. _"locked/corrupted DFF: declares 31 geometries, found 16"_) instead of a silent
   empty/partial spawn. Doesn't make them work — fails legibly.

## Reproduce

- **Variant A** — `yosemite.dff`: walk the clump children and compare the clump / GeometryList struct
  counts against the physically present `0x14` (atomic) / `0x0f` (geometry) chunks; or simulate
  `RwStreamFindChunk` count-based reads and watch the geometry scan exhaust the file before the atomics.
- **Variant B** — `cheetah.dff`: read the clump's first child header — the Struct (`0x01`) declares size
  `16777228` while its real payload is 12 bytes; `parseDff` then returns an empty model and
  `parseDffCollision` returns `null` even though a `COL3` chunk is present near EOF.

Related: [plan 015 — vehicle loading](../plans/015-vehicle-loading.md),
[plan 043 — DFF/TXD completeness](../plans/043-dff-txd-completeness.md).
