/**
 * Minimal parser for SA's `effects.fxp` (plan 044) — the TEXT "FX project" describing every
 * particle system the engine can instantiate (2dfx type-1 entries reference systems by name).
 *
 * We extract what data-driven emitters need: per system the cull distance + bounding sphere and
 * per emitter prim the texture, blend ids and EVERY keyframed parameter track, stored
 * generically as `"<info>.<channel>"` → keyframes (e.g. `emrate.rate`, `colour.red`,
 * `size.sizex`, `force.forcez`). Values are raw file units (colours 0–255, times normalized
 * 0–1 over the particle/system life).
 */

/** One emitter prim of a system (a system may layer several — fire = flame + smoke + haze). */
export interface FxEmitter {
  alphaOn: boolean;
  /** D3D blend ids as authored (src 4/dst 1 = additive glow, src 4/dst 5 = alpha blend). */
  dstBlendId: number;
  name: string;
  srcBlendId: number;
  /** Primary sprite texture (lowercased; '' when NULL) — lives in effectsPC.txd. */
  texture: string;
  /** Keyframed parameter tracks: `"<info>.<channel>"` (lowercased) → keys sorted by time. */
  tracks: Map<string, FxKeyframe[]>;
}

/** One keyframe of a parameter track. */
export interface FxKeyframe {
  time: number;
  value: number;
}

export interface FxSystem {
  /** x, y, z, radius. */
  boundingSphere: [number, number, number, number];
  cullDist: number;
  emitters: FxEmitter[];
  name: string;
}

/** Mutable cursor state of the line-by-line walk (which system/prim/info block we are inside). */
interface FxParserState {
  /** Open keyframe-track channel inside the current info block ('' = none). */
  channel: string;
  emitter: FxEmitter | null;
  /** Current `FX_INFO_<X>_DATA` block name, lowercased ('' = none). */
  infoName: string;
  /** True once a prim opened — disambiguates NAME (prim name vs system name). */
  inPrim: boolean;
  /** TIME of the keyframe whose VAL is expected next. */
  pendingTime: number;
  system: FxSystem | null;
  systems: Map<string, FxSystem>;
}

/** Parse `effects.fxp` into systems keyed by lowercased name. */
export function parseFxp(text: string): Map<string, FxSystem> {
  const state: FxParserState = {
    channel: '',
    emitter: null,
    infoName: '',
    inPrim: false,
    pendingTime: 0,
    system: null,
    systems: new Map(),
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length > 0) {
      parseLine(state, line);
    }
  }
  commitSystem(state);

  return state.systems;
}

/** Linearly sample a track at `t` (clamped to the first/last key). */
export function sampleFxTrack(keys: readonly FxKeyframe[], t: number): number {
  if (keys.length === 0) {
    return 0;
  }
  if (t <= keys[0].time) {
    return keys[0].value;
  }
  for (let i = 1; i < keys.length; i += 1) {
    if (t <= keys[i].time) {
      const span = keys[i].time - keys[i - 1].time;
      const f = span > 1e-9 ? (t - keys[i - 1].time) / span : 1;

      return keys[i - 1].value + (keys[i].value - keys[i - 1].value) * f;
    }
  }

  return keys[keys.length - 1].value;
}

/** Apply one `KEY: value` line to the open system/prim. Unknown keys are noise (LOOPED / NUM_KEYS /
 *  TIMEMODEPRT / MATRIX / LOD…) and are skipped. */
function applyKeyValue(state: FxParserState, key: string, value: string): void {
  switch (key) {
    case 'ALPHAON':
      patchEmitter(state, (emitter) => (emitter.alphaOn = value !== '0'));
      break;
    case 'BOUNDINGSPHERE':
      patchSystem(state, (system) => (system.boundingSphere = parseSphere(value)));
      break;
    case 'CULLDIST':
      patchSystem(state, (system) => (system.cullDist = Number(value)));
      break;
    case 'DSTBLENDID':
      patchEmitter(state, (emitter) => (emitter.dstBlendId = Number(value)));
      break;
    case 'NAME':
      applyName(state, value);
      break;
    case 'SRCBLENDID':
      patchEmitter(state, (emitter) => (emitter.srcBlendId = Number(value)));
      break;
    case 'TEXTURE':
      patchEmitter(state, (emitter) => (emitter.texture = value === 'NULL' ? '' : value.toLowerCase()));
      break;
    case 'TIME':
      state.pendingTime = Number(value);
      break;
    case 'VAL':
      pushKeyframe(state, Number(value));
      break;
    default:
      break;
  }
}

/** NAME routes to the open prim once inside one, else names the system (first NAME wins). */
function applyName(state: FxParserState, value: string): void {
  if (state.inPrim && state.emitter) {
    state.emitter.name = value;
  } else if (state.system && state.system.name.length === 0) {
    state.system.name = value.toLowerCase();
  }
}

function commitSystem(state: FxParserState): void {
  if (state.system && state.system.name.length > 0) {
    state.systems.set(state.system.name, state.system);
  }
}

/** Handle the block headers (`FX_SYSTEM_DATA:` / `FX_PRIM_*_DATA:` / `FX_INFO_<X>_DATA:`).
 *  Returns true when the line was a header. */
function handleHeader(state: FxParserState, line: string): boolean {
  if (line === 'FX_SYSTEM_DATA:') {
    commitSystem(state);
    state.system = { boundingSphere: [0, 0, 0, 0], cullDist: 0, emitters: [], name: '' };
    state.emitter = null;
    state.inPrim = false;
    state.infoName = '';

    return true;
  }
  if (line.startsWith('FX_PRIM_') && line.endsWith('_DATA:')) {
    if (line !== 'FX_PRIM_BASE_DATA:') {
      // FX_PRIM_BASE_DATA is a nested header of the prim just opened — anything else opens one.
      state.emitter = { alphaOn: true, dstBlendId: 5, name: '', srcBlendId: 4, texture: '', tracks: new Map() };
      state.system?.emitters.push(state.emitter);
      state.inPrim = true;
      state.infoName = '';
    }

    return true;
  }
  const info = /^FX_INFO_([A-Z0-9]+)_DATA:$/.exec(line);
  if (info) {
    state.infoName = info[1].toLowerCase();
    state.channel = '';

    return true;
  }

  return false;
}

function parseLine(state: FxParserState, line: string): void {
  if (handleHeader(state, line)) {
    return;
  }
  const colon = line.indexOf(':');
  if (colon < 0) {
    return; // count lines ("109") and other noise
  }
  const key = line.slice(0, colon);
  const value = line.slice(colon + 1).trim();

  // Bare "CHANNEL:" labels open a keyframe track inside the current info block.
  if (value.length === 0 && state.infoName.length > 0 && !key.startsWith('FX_')) {
    state.channel = key.toLowerCase();

    return;
  }
  applyKeyValue(state, key, value);
}

function parseSphere(value: string): [number, number, number, number] {
  const parts = value.split(/\s+/).map(Number);

  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, parts[3] ?? 0];
}

/** Run `patch` on the open emitter (no-op outside a prim). */
function patchEmitter(state: FxParserState, patch: (emitter: FxEmitter) => unknown): void {
  if (state.emitter) {
    patch(state.emitter);
  }
}

/** Run `patch` on the open system (no-op inside a prim — these keys are system-level only). */
function patchSystem(state: FxParserState, patch: (system: FxSystem) => unknown): void {
  if (state.system && !state.inPrim) {
    patch(state.system);
  }
}

/** Append `TIME/VAL` pair to the open `"<info>.<channel>"` track of the open emitter. */
function pushKeyframe(state: FxParserState, value: number): void {
  if (!state.emitter || state.infoName.length === 0 || state.channel.length === 0) {
    return;
  }
  const track = `${state.infoName}.${state.channel}`;
  let keys = state.emitter.tracks.get(track);
  if (!keys) {
    keys = [];
    state.emitter.tracks.set(track, keys);
  }
  keys.push({ time: state.pendingTime, value });
}
