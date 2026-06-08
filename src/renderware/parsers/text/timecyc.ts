import { HOURS, TIME_WEATHERS, WEATHER_NAMES } from './timecyc.parser';

export type Rgb = [number, number, number];
export type Rgba = [number, number, number, number];

export interface Timecyc {
  weathers: TimecycWeather[];
}

/** One resolved timecyc entry (a weather at an hour, or an interpolated sample). */
export interface TimecycHour {
  alpha1: number;
  alpha2: number;
  amb: Rgb;
  ambObj: Rgb;
  bottomClouds: Rgb;
  cloudAlpha: number;
  dir: Rgb;
  dirMult: number;
  farClip: number;
  fogStart: number;
  intensityLimit: number;
  lightOnGround: number;
  lightShadow: number;
  lowClouds: Rgb;
  poleShadow: number;
  rgb1: Rgb;
  rgb2: Rgb;
  shadow: number;
  skyBot: Rgb;
  skyTop: Rgb;
  spriteBright: number;
  spriteSize: number;
  sunCore: Rgb;
  sunCorona: Rgb;
  sunSize: number;
  water: Rgba;
  waterFogAlpha: number;
}

export interface TimecycWeather {
  /** 24 hourly rows (flat, FIELDS-ordered numbers); read via {@link sampleTimecyc}. */
  hours: number[][];
  name: string;
}

/** Group 24h rows (21 weathers × 24 hours) into the friendly per-weather structure. */
export function buildTimecyc(rows24: number[][]): Timecyc {
  const weathers: TimecycWeather[] = [];
  for (let w = 0; w < TIME_WEATHERS; w += 1) {
    weathers.push({ hours: rows24.slice(w * HOURS, w * HOURS + HOURS), name: WEATHER_NAMES[w] });
  }

  return { weathers };
}

/**
 * Sample a weather at a fractional `hour` (0–24, wraps): linearly interpolates
 * every field between the two surrounding hours. This is what sky/sun/light read
 * each frame with `game.getTime() / 60`.
 */
export function sampleTimecyc(timecyc: Timecyc, weatherIndex: number, hour: number): TimecycHour {
  return toHour(sampleRow(timecyc, weatherIndex, hour));
}

/**
 * Blend two weathers at the same `hour` by `t` (0 = `fromWeather`, 1 = `toWeather`): the basis for
 * smooth weather transitions. Lerps the flat rows (every field) like {@link sampleTimecyc} does for hours.
 */
export function sampleTimecycBlend(
  timecyc: Timecyc,
  fromWeather: number,
  toWeather: number,
  hour: number,
  t: number,
): TimecycHour {
  if (t <= 0 || fromWeather === toWeather) {
    return toHour(sampleRow(timecyc, fromWeather, hour));
  }
  if (t >= 1) {
    return toHour(sampleRow(timecyc, toWeather, hour));
  }
  const a = sampleRow(timecyc, fromWeather, hour);
  const b = sampleRow(timecyc, toWeather, hour);

  return toHour(a.map((value, i) => value + (b[i] - value) * t));
}

/** The flat, FIELDS-ordered row for a weather at a fractional `hour` (hourly lerp; wraps 0–24). */
function sampleRow(timecyc: Timecyc, weatherIndex: number, hour: number): number[] {
  const weather = timecyc.weathers[weatherIndex] ?? timecyc.weathers[0];
  const total = ((hour % HOURS) + HOURS) % HOURS;
  const h0 = Math.floor(total);
  const h1 = (h0 + 1) % HOURS;
  const f = total - h0;
  const a = weather.hours[h0];
  const b = weather.hours[h1];

  return a.map((value, i) => value + (b[i] - value) * f);
}

/** Map a flat FIELDS-ordered row to the named entry (read order must match {@link FIELDS}). */
function toHour(row: number[]): TimecycHour {
  let i = 0;
  const rgb = (): Rgb => {
    const v: Rgb = [row[i], row[i + 1], row[i + 2]];
    i += 3;

    return v;
  };
  const rgba = (): Rgba => {
    const v: Rgba = [row[i], row[i + 1], row[i + 2], row[i + 3]];
    i += 4;

    return v;
  };
  const n = (): number => {
    const v = row[i];
    i += 1;

    return v;
  };

  const amb = rgb();
  const ambObj = rgb();
  const dir = rgb();
  const skyTop = rgb();
  const skyBot = rgb();
  const sunCore = rgb();
  const sunCorona = rgb();
  const sunSize = n();
  const spriteSize = n();
  const spriteBright = n();
  const shadow = n();
  const lightShadow = n();
  const poleShadow = n();
  const farClip = n();
  const fogStart = n();
  const lightOnGround = n();
  const lowClouds = rgb();
  const bottomClouds = rgb();
  const water = rgba();
  const alpha1 = n();
  const rgb1 = rgb();
  const alpha2 = n();
  const rgb2 = rgb();
  const cloudAlpha = n();
  const intensityLimit = n();
  const waterFogAlpha = n();
  const dirMult = n();

  return {
    alpha1,
    alpha2,
    amb,
    ambObj,
    bottomClouds,
    cloudAlpha,
    dir,
    dirMult,
    farClip,
    fogStart,
    intensityLimit,
    lightOnGround,
    lightShadow,
    lowClouds,
    poleShadow,
    rgb1,
    rgb2,
    shadow,
    skyBot,
    skyTop,
    spriteBright,
    spriteSize,
    sunCore,
    sunCorona,
    sunSize,
    water,
    waterFogAlpha,
  };
}
