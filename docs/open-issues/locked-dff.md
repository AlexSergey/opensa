# "Locked" (anti-rip protected) DFF models

> **✅ SOLVED (2026-06-19; Variant D added 2026-06-24).** All four lock variants are handled; `cheetah.dff` /
> `yosemite.dff` / `walton.dff` parse fully — geometry, frames, atomics **and** the embedded COL — and
> gostown's `lodveg.txd` (TXD wrapper lock, variant C) recovers its textures. Kept here (not deleted) as a
> reference for the lock formats and the recovery, in case related regressions surface.

Both locks bloat chunk **sizes** to swallow siblings; the data is all present (the game reads by count,
ignoring sizes). Recovered the same way (see [Fix](#fix-2026-06-19) below). The spawn crash was already
fixed separately (a no-COL / locked vehicle falls back to a box chassis instead of throwing).

Four distinct lock variants — all falsify chunk metadata so a boundary-respecting parser (ours) chokes
while RenderWare's lenient (count- / scan-based) reader keeps going:

| Variant                          | Example                    | Tamper                                                                                                                                                                              | Fix                                                                                                             |
| -------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| B — inflated clump-struct size   | `cheetah.dff`              | the clump **Struct chunk size** is bloated to swallow all siblings                                                                                                                  | `forEachClumpChild` (canonical 12-byte struct)                                                                  |
| A — inflated item sizes          | `yosemite.dff` (Ford F350) | every **atomic / geometry chunk size** is bloated (+ `0x0` padding) to swallow following items                                                                                      | count-based RW recovery (`findChunkFrom`)                                                                       |
| C — hidden TexDictionary wrapper | `lodveg.txd` (gostown)     | the outer **TexDictionary (`0x16`) header is zeroed/obfuscated** (no readable `0x16` at all); inner `TEXTURE_NATIVE` chunks are intact                                              | byte-scan recovery (`recoverLockedTextures`)                                                                    |
| D — every container size bloated | `walton.dff` (Willys jeep) | **every** container size is bloated (clump Struct = B, FrameList → 1.2 GB past EOF, GeometryList swallows the Atomics) + versions scrambled; struct counts + leaf sizes stay honest | `forEachClumpChild` recomputes each child's end from its honest children (`contentEnd` / `CLUMP_CHILD_CONTENT`) |

> **Correction:** Variant A was first (wrongly) read as "inflated counts → data absent". It is not —
> the 31 atomics / 31 geometries are all present, each hidden behind the previous item's bloated size
> plus `0x0` size-0 padding. A boundary walk finds only 8 / 16; RW (and now we) read by count.

Both live in `game-src/original-extend/vehicles/`. The companion **`yosemite.txd` carries the same
inflated-size lock**: it declares 20 textures but a boundary walk finds 10 (each TEXTURE_NATIVE's size
swallows the next), so the body texture `F350_mix` was missing and the chassis rendered untextured.
`parseTxd` now applies the same count-based recovery (`recoverLockedList`) → all 20 textures. (It also has
the older leading-empty-chunk quirk, already handled by `readDictHeader`; see
[plan 043](../plans/043-dff-txd-completeness.md).)

## How RenderWare reads DFFs (why the locks target our parser)

`RpClumpStreamRead` (mirror: **librw**, OpenRW) reads a fixed **count** of children via
`RwStreamFindChunk`, scanning the flat stream forward and **ignoring parent chunk size boundaries**;
and it reads a struct's fixed fields (e.g. `numAtomics/numLights/numCameras`) **directly**, never
trusting the struct chunk's declared size to skip. Our parser instead walks children **strictly within**
each parent's declared `[start, end)` (`forEachChild`) — which both locks exploit.

## Variant A — inflated item sizes (`yosemite.dff`)

The clump declares 31 atomics / 31 geometries, but **every atomic and geometry chunk's declared size is
bloated** to swallow the items that follow (with `0x0` size-0 padding chunks interleaved). A
boundary-respecting walk advances by each bloated size and so finds only **8 atomics / 16 geometries**;
the 8 it sees index geometries `0, 2, 6, 10, 14, 19, 23, 27` (up to 27 — out of range for the 16 it
walked). The other items are **all present**, nested inside the bloated ranges.

RW reads each list by its **count** via `RwStreamFindChunk`, scanning forward (skipping the padding and
ignoring the bloated sizes) and advancing past each item's _real_ content — so it finds all 31 atomics
(indices `0…30`) and all 31 geometries (verts 1716, 1772, …, 2314; last ends exactly on the geomlist
boundary). That is why the game renders the truck whole.

**Recovered the same way:** `parseDff` / `parseGeometryList` keep the fast boundary walk, but when the
declared count exceeds what it found they re-read RW-style via `findChunkFrom` + `contentEnd` (struct +
[matlist] + extension). Triggers only on the count mismatch → no change for well-formed files.

## Variant B — inflated clump-struct size (`cheetah.dff`)

Here the **clump's first child (the Struct, `0x01`) declares size `16777228` (`0x0100000C`)** instead of
the real **`12` (`0x0C`)** — the high byte is tampered to `0x01`. A size-trusting walk seeks ~16 MB past
the struct, sees **only the struct**, and misses the FrameList, GeometryList, all 57 atomics, and the
Extension holding the `COL3` chunk. Fixed by `forEachClumpChild`: when the leading Struct overshoots the
clump it uses the canonical 12-byte SA clump-struct payload and resumes sibling iteration after it.
RenderWare survives the same way — it reads the struct's fixed fields directly and ignores the bogus size.

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

## Variant C — hidden TexDictionary wrapper (`lodveg.txd`, gostown)

A TXD-only lock that does **not** bloat sizes: the outer **TexDictionary (`0x16`) header is gone** — the
entry's first ~2 KB are zeroed and the chunk stream is obfuscated, so **no readable `0x16` exists anywhere**
(even Magic.TXD rejects it: _"unknown RenderWare stream block"_). But the inner **`TEXTURE_NATIVE` (`0x15`)
chunks are intact** — verified by byte-scanning `gostown6.img`'s `lodveg.txd`: 6 real textures
(`Gp_Grandpalm1/2`, `Gp_Grospalm1`, `Gp_petitpalm1`, `Gp_Grandfeuillu2`, `boardside`), readable names,
power-of-two dims, DXT3 + mips. The game renders them because RW's reader skips the unknown leading blocks
and reads the texture-natives; a parser that requires the `0x16` wrapper at the start fails.

**Recovered:** when `parseTxd` finds no usable TexDictionary, `recoverLockedTextures` **byte-scans** the
stream for `TEXTURE_NATIVE` chunks (type `0x15` + a `STRUCT` child + a plausible RW stream version
`…FFFF`) and parses each (the inner chunks keep intact sizes, so they parse normally). Hits are
sanity-checked (printable name + power-of-two dimensions) to avoid false matches in raster bytes, and
deduped by name. Triggers only when there's no `0x16` (or it yields nothing) → well-formed TXDs are
untouched. Covered by `tests/custom/txd/lodveg.txd` + a test in `txd.test.ts`. Recovery is at **load time**
(the locked bytes are packed as-is; the runtime parser reconstructs the dictionary), so no rebuild needed.

## Variant D — every container size bloated (`walton.dff`)

The most aggressive lock seen: it combines A + B and bloats **every container chunk's size**. Byte-probed:
the clump **Struct** declares `0x2798000C` (640 MB, = Variant B); the very first sibling **FrameList**
declares `0x48A81B0D` (→ 1.2 GB, overruns EOF); the **GeometryList** size swallows the 43 Atomics that follow
it; and **versions are scrambled** (`0x1803` kept, low 16 randomized vs `0x1803FFFF`). But the **honest signal
survives**: struct payload **counts** (`numAtomics = 43`, FrameList `numFrames = 77`) and all **leaf / child
sizes** are intact (the FrameList's inner Struct is exactly `4 + 77*56`; the 43 geometries have sane vert/tri
counts). So the data is fully recoverable **by count**, not by byte-scanning (a naive type-scan false-matches
`0x1A`/`0x0F`/`0x14` inside vertex/raster bytes — one probe "found" a 69 894-geometry list).

Without recovery, `parseDff` overruns on the first sibling (FrameList) and throws before ever reaching the
list-level Variant-A recovery; `recoverLockedAtomics`'s scan can't help either (`findChunkFrom` advances by the
bloated clump-Struct / FrameList sizes and bails). The version scramble turned out **not** to matter — version
is never a parse gate, so structural recovery alone suffices.

**Recovered:** `forEachClumpChild` detects the lock by the same bloated leading Struct (Variant B signature) and,
on a locked clump, recomputes **every** child's real end from its honest-sized children — `contentEnd` over a
per-container `CLUMP_CHILD_CONTENT` map (FrameList → `{Struct, Extension}`; GeometryList → `{Struct, Geometry}`;
Atomic → `{Struct, Extension}` with `stopAfter Extension` so the last Atomic doesn't swallow the trailing
clump-level Extension that holds the COL; clump Extension → `{Collision, Struct}`). Each child's parse then stays
bounded and the sibling walk lands on the next real chunk, so the geometry/atomic list parsers (and their own
A-recovery) take over. Valid clumps never trigger it (the leading Struct ends within the clump). Covered by
`tests/custom/locked-models/walton.dff` + tests in `dff.test.ts` (77 frames / 43 geometries / 43 atomics + COL).

## Fix (2026-06-19)

`parseDff` and `parseDffCollision` now iterate the clump via **`forEachClumpChild`** (in
`parsers/binary/chunks.ts`) instead of the size-trusting `forEachChild`. When the leading Struct's
declared size overshoots the clump end (impossible for a valid file), it uses the canonical **12-byte**
SA clump-struct payload and resumes sibling iteration right after it — recovering the FrameList,
GeometryList, all 57 atomics and the Extension (with COL3). Valid clumps are untouched (their Struct
ends within the clump, so the recovery branch never fires) → near-zero regression surface. Covered by a
committed custom fixture `tests/custom/locked-models/cheetah.dff` + tests in `dff.test.ts`.

For **Variant A**, `parseGeometryList`, `parseDff` and `parseTxd` add a count-based recovery via the shared
`recoverLockedList` (in `parsers/binary/chunks.ts`): after the normal boundary walk, if the declared
geometry / atomic / texture count is higher, they re-read the list RW-style with `findChunkFrom` (scan for
the next item past the bloated sizes + `0x0` padding) and `contentEnd` (advance by the item's real
children: struct + [matlist] + extension). Only runs on the mismatch → well-formed files are unaffected.
Covered by `tests/custom/locked-models/yosemite.dff` (31 atomics / 31 geometries) and the committed
`tests/custom/txd/yosemite.txd` (20 textures incl. `F350_mix`).

## What is fixed vs. what remains

- **Fixed — spawn no longer crashes (`physics-world.ts`).** Previously a locked/no-COL vehicle reached
  the chassis fallback with empty vertices; `ColliderDesc.convexHull(empty)` returns a **non-null but
  invalid** desc, so the `?? boxHull` guard never fired and `createCollider` threw _"expected instance
  of OA"_. `addConvexChassis` now only attempts the hull with enough points, wraps it in try/catch, and
  box-falls-back to the car's `halfExtents` (default `[1.2, 2.5, 0.7]`). This is a general robustness
  win for **any** vehicle with no usable COL, not just locked ones. Tests in `physics-world.test.ts`.
- **Fixed — Variant B renders (`forEachClumpChild`).** `cheetah.dff` now parses fully (83 frames / 57
  atomics / 57 geometries) with its embedded COL — see the fix section above.
- **Fixed — Variant A renders (count-based recovery).** `yosemite.dff` now recovers all 31 atomics / 31
  geometries; `buildVehicle` produces the full truck (4 wheels, doors, panels).
- **Fixed — Variant C textures recover (`recoverLockedTextures`).** gostown's `lodveg.txd` (no `0x16`
  wrapper) now yields its 6 LOD-vegetation textures via the byte-scan fallback, so the LOD ensembles render
  textured instead of flat grey.
- **Fixed — Variant D parses (`forEachClumpChild` content-walk).** `walton.dff` (every container size
  bloated) now recovers 77 frames / 43 geometries / 43 atomics + the embedded COL — see the Variant D
  section above.
- **Remains — byte-editing tools don't recover locks yet.** The engine `parseDff` / `parseDffCollision`
  handle all four variants, so in-game loading is fine. But the offline byte-editing tools (vehicle-optimizer
  scale / copy-effects, via **map-optimizer's** own size-trusting `readRw` in `codec/chunk.ts`) re-serialize
  raw chunks and still trust declared sizes — `readRw(walton)` finds **0 geometries**, so using a locked DFF
  as a `--prototype`/target there fails. To support that, add an `unlockDff(bytes)` that re-serializes clean
  headers (honest sizes) using the same recovery, so the generic codec reads a locked DFF as a standard one.
  Lower priority than in-game loading; not needed for clean Rockstar/most mod assets.

## Reproduce

- **Variant A** — `yosemite.dff`: the clump declares 31 atomics / 31 geometries; a boundary walk finds
  8 / 16 (atomics index up to 27), but reading each list by count with `RwStreamFindChunk`-style scanning
  (skip `0x0` padding, advance by each item's real struct/matlist/extension) recovers all 31.
- **Variant B** — `cheetah.dff`: read the clump's first child header — the Struct (`0x01`) declares size
  `16777228` while its real payload is 12 bytes; without `forEachClumpChild` `parseDff` returns an empty
  model and `parseDffCollision` returns `null` even though a `COL3` chunk is present near EOF.

Related: [plan 015 — vehicle loading](../plans/015-vehicle-loading.md),
[plan 043 — DFF/TXD completeness](../plans/043-dff-txd-completeness.md).
