/**
 * Curated per-weather cloud look. The raw timecyc `cloudAlpha` is noisy and doesn't read as the
 * weather's name (EXTRASUNNY still ends up fairly cloudy), so the sky dome's clouds are driven by
 * these hand-tuned profiles keyed off the weather **name** instead — clear+bright for sunny, fully
 * overcast with dark patches for cloudy, etc. Renderware-free; the sampler in the UI applies it.
 */
export interface CloudProfile {
  /** Base sky coverage, 0 (clear) → 1 (overcast). */
  coverage: number;
  /** Cloud heaviness, 0 (bright white) → 1 (dark, where the cover is thin reads as grey). */
  darkness: number;
}

/** Profile per weather family. SMOG variants add a small haze bump on top of their base (see below). */
const CLOUDY: CloudProfile = { coverage: 1, darkness: 0.9 };
const EXTRASUNNY: CloudProfile = { coverage: 0.14, darkness: 0 };
const FOGGY: CloudProfile = { coverage: 0.8, darkness: 0.2 };
const SUNNY: CloudProfile = { coverage: 0.32, darkness: 0.06 };
/** Fallback for anything not matched (e.g. a stray rain/storm/sandstorm selection). */
const DEFAULT: CloudProfile = { coverage: 0.5, darkness: 0.3 };

/** Extra coverage/darkness for the smoggy LA weathers — same base, but hazier. */
const SMOG_BUMP: CloudProfile = { coverage: 0.08, darkness: 0.06 };

/**
 * Map a weather name (from `WEATHER_NAMES`) to its cloud look. `SUNNY` is a substring of
 * `EXTRASUNNY`, so EXTRASUNNY is matched first; SMOG variants add a haze bump.
 */
export function cloudProfile(weatherName: string): CloudProfile {
  const base = baseProfile(weatherName);
  if (!weatherName.includes('SMOG')) {
    return base;
  }

  return {
    coverage: Math.min(1, base.coverage + SMOG_BUMP.coverage),
    darkness: Math.min(1, base.darkness + SMOG_BUMP.darkness),
  };
}

function baseProfile(weatherName: string): CloudProfile {
  if (weatherName.includes('CLOUDY')) {
    return CLOUDY;
  }
  if (weatherName.includes('FOGGY')) {
    return FOGGY;
  }
  if (weatherName.includes('EXTRASUNNY')) {
    return EXTRASUNNY;
  }
  if (weatherName.includes('SUNNY')) {
    return SUNNY;
  }

  return DEFAULT;
}
