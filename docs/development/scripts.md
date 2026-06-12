# Development scripts

Everything under `scripts/` with what it is for and real usage from past debugging sessions.
All TypeScript scripts run via `npx tsx`, `.mjs` ones via `node`.

## Contents

- [Build / asset pipeline](#build--asset-pipeline)
  - [pack-img.mjs](#pack-imgmjs)
  - [pack-anim-img.mjs](#pack-anim-imgmjs)
  - [gen-ipl-manifest.mjs](#gen-ipl-manifestmjs)
  - [gen-wind-list.ts](#gen-wind-listts)
  - [extract-viewer-collision.ts](#extract-viewer-collisionts)
  - [stretch-night.mjs](#stretch-nightmjs)
- [Debugging / auditing](#debugging--auditing)
  - [audit-rw-coverage.ts](#audit-rw-coveragets)
  - [inspect-area.ts](#inspect-areats)
  - [find-instances.ts](#find-instancests)
  - [model-bbox.ts](#model-bboxts)
  - [check-cell-signs.ts](#check-cell-signsts)
  - [find-2dfx.ts](#find-2dfxts)
  - [dump-chunks.ts](#dump-chunksts)
  - [dump-texture.ts](#dump-texturets)
  - [dump-fx-system.ts](#dump-fx-systemts)
  - [solve-roadsign.ts](#solve-roadsignts)
  - [procobj-stats.ts](#procobj-statsts)
  - [wind-coverage.ts](#wind-coveragets)
  - [ide-flag-histogram.ts](#ide-flag-histogramts)
- [In-game debug URL params](#in-game-debug-url-params)

---

## Build / asset pipeline

### pack-img.mjs

Packs the extracted model folders into one stock **GTA VER2 IMG** archive (the same format the
game and mods use). Streams data, so the ~600 MB output never sits in memory. Later source
folders override earlier ones by lowercased name. Keeps `.dff/.txd/.col/.ifp`; stream IPLs are
NOT packed — they are served from `static/ipl_binary/` instead.

```sh
node scripts/pack-img.mjs            # default: static/img/gta3,gta3additional,gta3anim → gta3-pf.img
node scripts/pack-img.mjs --all      # every file, not just the model extensions
IMG_SRC=dirA,dirB IMG_OUT=/out.img node scripts/pack-img.mjs
```

Real use: repacked after adding `static/img/gta3anim` (zone IFPs for animated map objects) so
`counxref.ifp` reached the runtime archive.

### pack-anim-img.mjs

Packs every `*.ifp` from the extracted `static/anim/anim.img/` folder plus the loose `ped.ifp`
into `static/anim/animations.img` — the single archive `loadAnimations` reads at runtime.

```sh
node scripts/pack-anim-img.mjs
ANIM_SRC=dir ANIM_PED=ped.ifp ANIM_OUT=out.img node scripts/pack-anim-img.mjs
```

### gen-ipl-manifest.mjs

Regenerates `static/ipl_binary/manifest.json` — `{ basename: streamCount }` — so `resolveMap`
fetches exactly the binary stream IPLs that exist instead of probing by 404. Re-run after adding
or removing `*_streamN.ipl` files.

```sh
node scripts/gen-ipl-manifest.mjs
```

### gen-wind-list.ts

Regenerates the `WIND_MODELS` constant in `src/game/mods/wind-mode.ts` from the ground-truth
folder `static/wind/` (the set of models that must sway). Re-run after adding wind-adapted
models.

```sh
npx tsx scripts/gen-wind-list.ts
```

### extract-viewer-collision.ts

One-time pre-bake: extracts the COL of the object-viewer's model list out of the IMG into small
`static/viewer/<model>.col.json` files so `/object-viewer.html` doesn't download the full
archive. Re-run after adding models to the viewer list.

```sh
npx tsx scripts/extract-viewer-collision.ts
```

### stretch-night.mjs

One-off timecyc tool: remaps hour rows of the "gtadrive Atmosphere Simulation" 24h timecyc
(stretching the night) while keeping comments/labels byte-identical. Kept for reproducibility of
the shipped `timecyc_24h` variant.

```sh
node scripts/stretch-night.mjs
```

---

## Debugging / auditing

All of these mirror `resolveMap` offline (fs instead of fetch) over `static/`, so they see
exactly what the game would.

### audit-rw-coverage.ts

Full RenderWare coverage audit: walks every DFF/TXD in the extracted model folders and reports
what the data ACTUALLY contains vs what the parsers handle — DFF chunk-type histogram, the
complete 2dfx entry census, multi-UV-layer model count, parse failures; TXD format histogram and
how many textures the classifier drops. The ground truth behind plan 043.

```sh
npx tsx scripts/audit-rw-coverage.ts
```

Real use: established 13126/0-failure DFF coverage, the 36 dropped 16-bit textures, and the
prioritized parser gap list (particles, escalators, Breakable, HAnim, dual UV).

### inspect-area.ts

Area inspector for "model missing / black / not picked" bugs: lists every map instance within a
radius of a point with WHY it would (not) render — def present, LOD class, interior code, DFF in
archive, parse result, TXD presence.

```sh
npx tsx scripts/inspect-area.ts <x> <y> [radius=120]
npx tsx scripts/inspect-area.ts 2908 -1058 60     # the pier-hole case
```

Real use: the `ce_grndpalcst05` pier hole — showed the placement existed and pointed onward to
the bbox check.

### find-instances.ts

Finds every placement of a model (or id) across ALL map IPLs — text, binary streams AND the
standalone script-gated groups — with the source file of each. Companion to `inspect-area.ts`
for "ghost text placement vs real streamed placement" cases.

```sh
npx tsx scripts/find-instances.ts <modelNameOrId> [...more]
npx tsx scripts/find-instances.ts se_bit_17 vegasnroad19
```

Real use: located the road-sign host instances and their interior=1024 area codes; resolved the
world-vs-local 2dfx coordinate question.

### model-bbox.ts

Prints a model's frame tree and DFF bbox (direct and frame-chained) vs its COL bbox. Diagnosis
rule: "collision present, mesh missing/floating elsewhere" → if DFF==COL the bug is
transform/culling; if raw-geometry==COL but a frame is non-identity, a junk frame translation is
being applied where SA would ignore it.

```sh
npx tsx scripts/model-bbox.ts <model> [...more]
npx tsx scripts/model-bbox.ts ce_grndpalcst05
```

Real use: proved the pier-hole model shipped a stray (12.85, 317.05, −28.52) frame translation.

### check-cell-signs.ts

Reproduces the cell build's road-sign path offline: for a world position, lists the HD cell's
model groups, parses each clump from the PLAYED archive, and reports which carry 2dfx roadsign
entries — pinpoints where a missing sign drops out (def → grid → archive → parse).

```sh
npx tsx scripts/check-cell-signs.ts <x> <y> [imgPath=static/models/gta3-pf.img]
npx tsx scripts/check-cell-signs.ts 420 640 static/models/gta3-original.img
```

Real use: proved the desert signs' data pipeline was clean, isolating the bug to rendering (the
glyph quad buried inside the board).

### find-2dfx.ts

Scans DFFs for 2d Effect entries: histograms entry types across the map and decodes every
ROADSIGN (type 7) — model, flags, plate size, rotation, position, text lines. Byte-stepped (a
4-byte stride misses unaligned chunks). `--img` scans inside an archive instead of the extracted
dirs — diffing the two exposes re-export damage.

```sh
npx tsx scripts/find-2dfx.ts | tail -50
npx tsx scripts/find-2dfx.ts --img static/models/gta3-original.img > 2dfx-original.txt
```

Real use: the road-sign survey (112 entries / 43+ models), pinning the 88-byte entry layout
empirically, and PF-vs-original data comparison.

### dump-chunks.ts

Prints a RenderWare file's chunk tree (type, offset, size) — diagnoses WHERE a plugin chunk
lives (e.g. whether a 2d Effect is attached to a geometry extension or somewhere the runtime
parser doesn't look).

```sh
npx tsx scripts/dump-chunks.ts static/img/gta3/se_bit_17.dff
npx tsx scripts/dump-chunks.ts <file> 253f2f8     # filter by chunk type
```

### dump-texture.ts

Dumps one texture from a TXD to PNG (no deps — software DXT1/3/5 decode + zlib IDAT). The
`alpha` mode bakes the alpha channel to opaque grayscale and reflows/zooms tall glyph strips —
that is how the `roadsignfont` atlas layout was read by eye.

```sh
npx tsx scripts/dump-texture.ts static/models/particle.txd roadsignfont out.png alpha
```

### dump-fx-system.ts

Dumps one `effects.fxp` system: emitter prims with textures/blend ids and every keyframed
track. This is how the fire system's COLOURBRIGHT tracks (vs the usual COLOUR) and its
0→peak→0 alpha envelope were discovered (plan 044).

```sh
npx tsx scripts/dump-fx-system.ts fire
npx tsx scripts/dump-fx-system.ts water_fountain static/models/effects.fxp
```

### solve-roadsign.ts

Brute-forces the road-sign plate transform: enumerates Euler orders × angle signs × angle→axis
maps × base plate triads and keeps combinations where EVERY observed rotation family renders
upright, lines-down and unmirrored. Found the unique convention (order Z→X→Y, base W=+X L=−Y
N=−Z) after hand calibration proved unreliable (90°-multiple rotations satisfy several wrong
conventions).

```sh
npx tsx scripts/solve-roadsign.ts
```

### procobj-stats.ts

procobj scatter sanity counts for one cell: per model / per category, vanilla density
(lottery < 1) vs full 3× capacity, plus an area-weighted surface histogram (COL material id →
surfinfo name, m², rule matches, top contributing model).

```sh
npx tsx scripts/procobj-stats.ts -450 1500    # desert cell
```

Real use: confirmed the desert cell scatters cacti/bushes on the right surfaces and sized the
`procObjLimit` budget.

### wind-coverage.ts

Wind audit: compares the ground-truth `static/wind/` set against the runtime `WIND_MODELS`
constant, IDE vegetation flags and prelit-alpha weights — reports unweighted models, missing
list entries and alpha-rule false positives.

```sh
npx tsx scripts/wind-coverage.ts
```

Real use: exposed the 128 false positives of the alpha-as-trigger design (roads, LTS overlays,
piers), which led to the list-as-trigger redesign.

### ide-flag-histogram.ts

Histogram of IDE object-flag bits across every shipped `.ide`, with example models per bit — to
see which SA engine flags the renderer still ignores.

```sh
npx tsx scripts/ide-flag-histogram.ts
```

Real use: scoped plan 039 (which render-relevant flags to implement: DRAW_LAST, ADDITIVE,
NO_ZBUFFER_WRITE, DISABLE_BACKFACE_CULLING, IS_TREE/IS_PALM).

---

## In-game debug URL params

Not scripts, but part of the same toolbox:

- `?nocull=1` — disables frustum culling on every streamed mesh each frame; if a "missing" model
  appears, its bounding sphere (not the geometry) is the bug.
- `?shadowdebug=1` — paints the world-shadow term red and draws the sun shadow camera frustum
  (separates real shadows from SSAO / baked prelit darkening).
