---
name: locked-dff-recovery
description: Anti-rip "locked" DFF/TXD models parse via count-based recovery (inflated chunk sizes, not absent data) — cheetah + yosemite SOLVED
metadata:
  type: project
---

Anti-rip "locked" GTA SA models (e.g. `cheetah.dff`, `yosemite.dff`/`.txd` from `original-extend`) defeat a
boundary-respecting chunk walk by **bloating chunk SIZES so each item swallows its siblings** (+ `0x0`
size-0 padding). The data is all present — RenderWare (and the game) read lists **by count**, scanning and
ignoring sizes. SOLVED 2026-06-19, verified in-game.

**Two lock forms, both recovered:**

- **clump Struct size bloated** (cheetah) → `forEachClumpChild` (chunks.ts): if the leading Struct overshoots
  the clump, use the canonical 12-byte SA clump-struct and resume after it.
- **per-item sizes bloated** (yosemite): atomics, geometries AND textures each declare more than a walk finds.
  Recovered by `recoverLockedList` (chunks.ts) — read by the declared count, `findChunkFrom` (RwStreamFindChunk)
  to the next item, `contentEnd` to advance by its real children (struct + [matlist] + extension). Used by
  `parseDff` (atomics), `parseGeometryList` (geometries) and `parseTxd` (textures).

**Key gotcha:** all recovery is **recovery-on-mismatch** — only runs when the declared count exceeds the
boundary-walk count, so well-formed files are untouched (≈0 regression). Texture name match is
case-insensitive (DFF `f350_mix` ↔ TXD `F350_mix`).

The earlier `docs/open-issues/locked-dff.md` claim "Variant A = data absent / unrecoverable" was WRONG — it
was the inflated-size lock; the 31 atomics / 31 geometries / 20 textures are all present. Fixtures:
`tests/custom/locked-models/{cheetah,yosemite}.dff` + `tests/custom/txd/yosemite.txd`. See [[test-fixtures]],
[[renderware-loader]].
