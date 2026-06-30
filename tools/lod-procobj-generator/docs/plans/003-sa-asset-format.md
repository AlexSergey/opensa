# 003 — SA asset-format requirements (procobj simplified-copy LODs)

The same strict-SA theme as `lod-trees-generator`'s [005](../../../lod-trees-generator/docs/plans/005-sa-asset-format.md):
**SA's RenderWare is strict where our parser/viewer is lenient**, so a DFF/TXD/COL/IDE that loads in the viewer can
be invisible — or crash — in-game. Most of these are enforced by the shared `@opensa/sa-lod` / `@opensa/map-placement`
encoders (the same ones `opensa-lod-generator` uses), so this tool inherits them; the list below is what specifically
matters for **procobj simplified-copy LODs** (a decimated mesh + a downscaled texture, _not_ a card impostor).

## Object id ≤ 18630

`allocateLodIds` only hands out ids in the **`[ID_MIN, 18630]`** window (gaps allowed, deterministic). Ids above
18630 **silently fail to load on stock SA** (no limit adjuster) → the "HD swapped, but no LOD shows" symptom. Do
not widen the window. The LOD model name is the IMG entry base, so it must be ≤ 19 chars — `lodAlias` falls back to
`lpo<index>` when `lod<model>` would overflow.

## DFF (the decimated mesh)

Encoded by `@opensa/sa-lod/encode-dff` (shared with `opensa-lod-generator`), which already handles the two classic traps:

- **Tristrip flag must match the data** — the geometry is written as a triangle **list**; leaving
  `rpGEOMETRYTRISTRIP` set makes SA read it as a strip → draws nothing.
- **No stale `rpEXTRAVERTCOLOUR`** — the extra-vertex-colour extension must be sized to the actual vertex count (or
  dropped), else SA applies stale colours/alpha → black / transparent mesh.

Procobj-specific: the mesh is **frame-baked** (`mesh-builder.ts` applies each atomic's frame right/up/at +
translation). Many procobj species are single-atomic, but bushes/scrub with offset frames must bake correctly or
the LOD sits at the wrong local origin (the same "bug 3" frame-transform fix the tree tool got). The mesh stays
**model-local** — world placement comes from the IPL `inst`.

## TXD (one shared `lod_procobj.txd`)

`@opensa/sa-lod/encode-txd` 2× box-downscales each texture until both dimensions are ≤ `--tex` (default **64 px**),
then **DXT-compresses** it with a mip chain (**DXT1** opaque / **DXT5** alpha, via `encodeDxtStruct`) — the same
encoder `opensa-lod-generator` uses, where uncompressed TXDs blew the IMG up ~4×. (On the stock procobj set: 15 DXT1 + 26
DXT5.) One shared dictionary (name-prefixed entries) = fewer IMG entries. Sources resolve `--txd` first, then the
**stock game TXD** as fallback.

## COL (one shared `lod_procobj.col`)

`@opensa/sa-lod/encode-col` emits a **COL3 bounds-only** library — one 112-byte empty-collision model per LOD
(name(22) + modelId(2) + bounds(40) + a 48-byte zero tail), exactly what SA's LOD vegetation ships (`lodCedar1_hi`:
bounds set, zero spheres/boxes/faces/verts). SA binds collision by **model name**, so each LOD alias needs an entry
even though procobj clutter has no real collision. A non-112-byte / wrong-version COL crashes the streamer.

## IDE + gta.dat registration

- `buildLodIde` emits an `objs` section `id, model, txd, drawDistance, flags` (ordered by id, CRLF) referencing the
  shared `lod_procobj` txd at `--draw`.
- `patchGtaDat` splices the `DATA\MAPS\LOD_PROCOBJ.IDE` line; the `convertProcObj` IPL `datLine` is appended. The
  IDE must be listed **before** the IPL that instances it, and the txd name must match the packed dictionary.

## IPL LOD-index coupling

The static IPL `convertProcObj` writes links each HD `inst` to its LOD `inst` by a **text-internal `lod` index**
(the index into the same IPL's `inst` list). This is a self-contained text IPL (not a binary stream pair), so the
coupling is local — but the rule from the [[ipl-lod-index-coupling]] memory still holds: never reorder or partially
strip these `inst` rows, or the `lod` indices point at the wrong object → wrong-LOD / crash.

## Never-touch species

`UNDERWATER_PROCOBJ` (seaweed / starfish / searock01–06) are **never converted** (and never stripped) — enforced in
`@opensa/map-placement`'s procobj strip. Shared land debris (`p_rubble*`) is deliberately **not** in that set.

## Cross-references

- Shared checklist memory: [[sa-generated-asset-format]] (tristrip flag, extra-vert-colour, DXT5/RGBA, 112-byte
  COL3, id ≤ 18630) and [[ipl-lod-index-coupling]].
- The impostor counterpart: `lod-trees-generator`
  [005](../../../lod-trees-generator/docs/plans/005-sa-asset-format.md) — same traps, different LOD strategy (cards +
  DXT5 atlas vs decimated mesh + small RGBA TXD).
