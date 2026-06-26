# 003 — map strip (stage 1: remove the source trees from the world)

When `--game` is given, the generator removes every placement of the `--dff` trees (and their old `lod<name>`
LODs) from the map, so the new impostors can replace them. This doc records **how SA actually links HD↔LOD**,
because the obvious "just delete the rows" approach crashes the game — and the non-obvious reason why.

## Where the trees live

A map area (e.g. `countrye`) is split across three places:

| source                 | file(s)                                         | holds                                                              |
| ---------------------- | ----------------------------------------------- | ------------------------------------------------------------------ |
| **text IPL**           | `data/maps/country/countrye.ipl`                | LOD bigbuildings (`LOD…`, `lod_…`) + some always-loaded HD (roads) |
| **binary IPL streams** | `countrye_stream*.ipl` inside `models/gta3.img` | the streamed HD detail objects                                     |
| **procobj**            | `data/procobj.dat`                              | `CPlantMgr` procedural scatter rules (grass, cacti, small plants)  |

`procobj.dat` is independent (tab-separated rows, no count header) — drop the rows whose model is a tree, done.
The IPLs are the hard part.

## The LOD link is an index — and it is **shared** across text + binary

Each placement (`inst`) carries a `lod` field. **It is an index into the area's _text_ IPL instance list**:

- a **text** instance's `lod` indexes its own file (within-file HD→LOD, e.g. `laeroad39` → `LODroad39t`);
- a **binary stream** instance's `lod` indexes the **companion text IPL** of the same area — _not_ the stream.

So the text IPL is the one shared index space the whole area points into. Verified against a clean US 1.0
install:

- per-file vs global index: **per-file wins** (1417/1419 text pairings resolve to a `LOD*` model vs 935 global);
- binary `lod` resolved against the companion text: `countrye_stream*` → `countrye.ipl` gives perfect pairings
  (`cunte_roads16` `lod=202` → `countrye.ipl[202]` = `LODcunte_roads16`), and **0** against the stream itself.

### Why naïve deletion crashes

- **Delete/shift any text row** → every index at or after it shifts → all binary HDs that pointed past it now
  resolve to the wrong (or missing) bigbuilding → mass dangling LOD → crash. This happens even when the deleted
  row is a `lod=-1` bigbuilding that links to nothing itself (the canonical `countrye.ipl` case).
- **Re-index the binary `lod` _within_ the stream** (treating it as a stream index) → writes garbage into a
  field that is really a text index → "model ID … does not have loaded collision" crash.

Both were real failure modes during bring-up.

## Algorithm — one removal map per area

1. Resolve the tree object ids from the IDEs in `gta.dat` (plus the `lod<name>` model names).
2. **Text first.** For each text IPL, drop tree rows (+ transitively their within-file LOD targets), re-index
   the surviving within-file `lod` links, and **return the old→new instance-index map**
   ([`stripTextIpl`](../../src/adapters/gta-sa/strip/ipl-text.ts)).
3. **Binary second.** For each stream, drop tree HDs by id and remap each survivor's `lod` through its area's
   text map — no within-stream re-index ([`stripBinaryIpl`](../../src/adapters/gta-sa/strip/ipl-binary.ts)).
   Streams pair to text by area key: `countrye_stream3.ipl` & `countrye.ipl` → `countrye`. A stream with no
   companion text leaves its `lod` untouched.
4. **procobj** — drop the tree scatter rows ([`stripProcObj`](../../src/adapters/gta-sa/strip/procobj.ts)).

Text and binary are coupled: they must be stripped **together** and applied together. Replacing only the data
files (original `gta3.img`) or only `gta3.img` (original data) reintroduces the index mismatch and crashes.

Output under `--out`: a repacked `gta3.img` (or loose `gta3img/` with `--loose`), the edited text IPLs under
their `data/maps/...` paths, and `data/procobj.dat`. Orchestrated by
[`strip-map.ts`](../../src/adapters/gta-sa/strip/strip-map.ts).

## Verification

Offline, across `countrye`/`countryw`/`lan`/`sfse`: every surviving HD→LOD pairing (binary→text **and**
text-internal) resolves to the exact same model after stripping — 0 broken. In-game (US 1.0): loads clean, trees
gone. Unit + real-fixture tests live next to the code (`*.test.ts`); the `lae` (coupled urban pair) and
`countrye` (tree LOD bigbuildings) fixtures come from `npm run test:fixtures`.

## Invocation

This whole-map strip is the `--strip` verification mode (empty world). The shipping pipeline is the **place**
stage ([004](./004-map-place.md)) — it keeps the HD trees and _attaches_ impostor LODs instead of removing them.

## Stage 2 (next)

Place the HD trees + the new impostor `lod<name>` at the cleared positions (new `inst` rows + IDE defs +
`lodtrees.txd`/`.col`), reusing the same per-area index discipline when adding the HD→LOD links back.
