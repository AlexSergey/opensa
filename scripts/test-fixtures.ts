import { buildVer2Buffer, type ImgArchive, openArchive } from '@opensa/renderware/archive/img-archive';
import { convertTo24h, parseTimecyc, stringifyTimecyc } from '@opensa/renderware/parsers/text/timecyc.parser';
/**
 * Reconstruct the real-asset test fixtures (`tests/original/`) from a clean, UNMODIFIED GTA San Andreas
 * install under `game-src/non-modified` (default). These are Rockstar assets, so they are NOT committed
 * (`tests/original/` is gitignored) — every contributor regenerates them locally on setup, or after
 * changing the manifest:
 *
 *   npm run test:fixtures
 *
 * Custom, non-Rockstar fixtures live in `tests/custom/` and ARE committed — this script never touches them.
 *
 * Each fixture declares how it is produced:
 *   - copy:    copied verbatim from `game-src/<game>/<from>`
 *   - extract: extracted by name from a `models/*.img` archive
 *   - archive: a one-file stock VER2 `.img` built around an extracted entry
 *
 * Extend MANIFEST when a test needs a new real-asset fixture.
 *
 * `data/timecyc_24h.dat` is generated here (the stock 24h expansion of timecyc.dat, no mod overlay).
 * Curated / version-pinned test models that can't be reproduced from a stock copy live committed under
 * `tests/custom/proper-fixes-models/` instead.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

type Fixture =
  | { readonly dest: string; readonly entry: string; readonly type: 'archive' }
  | { readonly dest: string; readonly entry: string; readonly type: 'extract' }
  | { readonly dest: string; readonly from: string; readonly type: 'copy' };

const gameIndex = process.argv.indexOf('--game');
const GAME = gameIndex >= 0 ? process.argv[gameIndex + 1] : 'non-modified';
const ROOT = join('game-src', GAME);
const ARCHIVES = ['models/gta3.img', 'models/gta_int.img'];
const OUT = 'tests/original';

const copy = (from: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, from, type: 'copy' });
const extract = (entry: string, dest: string): Fixture => ({ dest: `${OUT}/${dest}`, entry, type: 'extract' });

const MANIFEST: readonly Fixture[] = [
  // --- Loose data / config / text files (copied verbatim) ---
  copy('data/gta.dat', 'data/gta.dat'),
  copy('data/object.dat', 'data/object.dat'),
  copy('data/procobj.dat', 'data/procobj.dat'),
  copy('data/surfinfo.dat', 'data/surfinfo.dat'),
  copy('data/timecyc.dat', 'data/timecyc.dat'),
  copy('data/carcols.dat', 'data/carcols.dat'),
  copy('data/water.dat', 'data/water.dat'),
  copy('data/vehicles.ide', 'data/vehicles.ide'),
  copy('data/handling.cfg', 'data/handling.cfg'),
  copy('data/info.zon', 'data/info.zon'),
  copy('data/maps/generic/barriers.ide', 'data/barriers.ide'),
  copy('data/maps/interior/int_cont.ipl', 'data/int_cont.ipl'),
  copy('models/effects.fxp', 'models/effects.fxp'),
  copy('models/effectsPC.txd', 'models/effectsPC.txd'),
  copy('text/american.gxt', 'text/american.gxt'),
  // Player character + a second ped, both stock SA peds regenerated from gta3.img (no custom character model
  // is committed): bmypol1 (a cop — the player model the character tests use) + its txd, and army (skeleton
  // frames in a different order than the HAnim hierarchy — the plan 052 ordering guard).
  extract('bmypol1.dff', 'character/bmypol1.dff'),
  extract('bmypol1.txd', 'character/bmypol1.txd'),
  extract('army.dff', 'character/army.dff'),

  // --- Entries extracted from the IMG archives ---
  extract('barriers.col', 'col/barriers.col'),
  extract('countn2_17.col', 'col/countn2_17.col'),
  extract('lae_stream0.ipl', 'ipl_binary/lae_stream0.ipl'),
  // Map-strip fixtures (lod-trees-generator): a text IPL + its companion binary stream share one LOD-index space
  // — a stream's `lod` indexes into its area's text IPL. `lae` is a coupled urban pair (the text has its own
  // internal HD→LOD links AND `lae_stream0` HDs point into it); `countrye` is the canonical countryside case
  // where the text holds tree LOD bigbuildings (`lod_vbg_fir_co`, all `lod -1`) referenced from `countrye_stream1`.
  copy('data/maps/la/lae.ipl', 'ipl_text/lae.ipl'),
  copy('data/maps/country/countrye.ipl', 'ipl_text/countrye.ipl'),
  extract('countrye_stream1.ipl', 'ipl_binary/countrye_stream1.ipl'),
  extract('counxref.ifp', 'dff/anim-clump/counxref.ifp'),
  extract('nt_noddonkbase.dff', 'dff/anim-clump/nt_noddonkbase.dff'),
  extract('binnt08_la.dff', 'dff/breakable/binnt08_la.dff'),
  extract('washer.dff', 'dff/building/washer.dff'),
  // A stock vegetation LOD DFF — the template the lod-trees-generator rebuilds card geometry over. Carries the
  // tristrip flag + an extra-vertex-colour (0x253f2f9) extension, both of which the encoder must scrub (else SA
  // renders the impostor as nothing).
  extract('lodroadscoast02.dff', 'dff/lod-template/lodroadscoast02.dff'),
  extract('esc_step.dff', 'dff/escalator/esc_step.dff'),
  extract('escl_la.dff', 'dff/escalator/escl_la.dff'),
  extract('ws_floodbeams.dff', 'dff/floodbeams/ws_floodbeams.dff'),
  extract('ce_grndpalcst05.dff', 'dff/frame-offset-ignored/ce_grndpalcst05.dff'),
  extract('skullpillar01_lvs.dff', 'dff/particle/skullpillar01_lvs.dff'),
  extract('dyntraffic.txd', 'dff/trafficlight-backface-culling/dyntraffic.txd'),
  extract('admiral.dff', 'dff/vehicle/admiral.dff'),
  extract('squalo.dff', 'dff/vehicle/squalo.dff'),
  // infernus: the vehicle-optimizer scale test fixture — a hierarchical rig (dummies) + embedded COL3 collision.
  extract('infernus.dff', 'dff/vehicle/infernus.dff'),
  extract('admiral.dff', 'vehicles/admiral.dff'),
  extract('junk.txd', 'txd/junk.txd'),
  extract('compfukhouse3.dff', 'world/compfukhouse3.dff'),
  extract('mcstraps_LAe2.dff', 'world/mcstraps_LAe2.dff'),

  // --- Derived: a stock VER2 archive holding a single extracted vehicle ---
  { dest: `${OUT}/img/admiral.img`, entry: 'admiral.dff', type: 'archive' },
];

let archives: ImgArchive[] | null = null;

function extractEntry(name: string): null | Uint8Array {
  for (const archive of openArchives()) {
    const data = archive.get(name);
    if (data) {
      return new Uint8Array(data);
    }
  }

  return null;
}

function openArchives(): ImgArchive[] {
  archives ??= ARCHIVES.map((rel) => openArchive(new Uint8Array(readFileSync(join(ROOT, rel)))));

  return archives;
}

function produce(fixture: Fixture): null | Uint8Array {
  switch (fixture.type) {
    case 'archive': {
      const data = extractEntry(fixture.entry);

      return data ? buildVer2Buffer([{ data, name: fixture.entry }]) : null;
    }
    case 'copy': {
      return new Uint8Array(readFileSync(join(ROOT, fixture.from)));
    }
    case 'extract': {
      return extractEntry(fixture.entry);
    }
  }
}

let written = 0;
const missing: string[] = [];

for (const fixture of MANIFEST) {
  let data: null | Uint8Array = null;
  try {
    data = produce(fixture);
  } catch {
    data = null;
  }
  if (!data) {
    missing.push(fixture.dest);
    continue;
  }
  mkdirSync(dirname(fixture.dest), { recursive: true });
  writeFileSync(fixture.dest, data);
  written += 1;
}

// Generated: the stock 24-hour timecyc (convertTo24h of timecyc.dat), no RealVision/mod overlay — the
// game build's `npm run timecyc` keeps its own enhanced merge; this fixture stays a plain stock expansion.
try {
  const timecyc = readFileSync(join(ROOT, 'data', 'timecyc.dat'), 'utf8');
  const dest = `${OUT}/data/timecyc_24h.dat`;
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, stringifyTimecyc(convertTo24h(parseTimecyc(timecyc))));
  written += 1;
} catch {
  missing.push(`${OUT}/data/timecyc_24h.dat`);
}

console.log(`test:fixtures (${GAME}): wrote ${written}/${MANIFEST.length + 1} into ${OUT}/`);
if (missing.length > 0) {
  console.error(`\n  MISSING ${missing.length} — source not found in ${ROOT}:`);
  for (const dest of missing) {
    console.error(`    - ${dest}`);
  }
  console.error(`\n  Ensure game-src/${GAME} is a complete, unmodified GTA San Andreas install.`);
  process.exitCode = 1;
}
