/**
 * Vehicle-reflection presets (plan 030), inspired by SkyGFX's per-platform pipelines. The DFF reflection
 * data (which materials reflect + coefficient/intensity) is parsed once and is preset-independent; a preset
 * only decides the **source**, the **technique**, and the **tuning**. Adding a new look = one `PRESETS`
 * entry — the plugin branches on a preset's *fields*, never on its name.
 */
export interface ReflectionPreset {
  /** Reflective clearcoat strength (0–1) — the glossy lacquer over the paint that shows the env map. */
  clearcoat: number;
  /** Clearcoat roughness (lower = sharper, mirror-like reflections). */
  clearcoatRoughness: number;
  /** Display name (for the debug selector). */
  label: string;
  /** Target metalness for reflective body materials (kept ~0 for clearcoat paint). */
  metalness: number;
  /** Global reflection-strength multiplier over the DFF coefficient. */
  reflectivity: number;
  /** Target base roughness for reflective body materials (under the clearcoat). */
  roughness: number;
  /** Where the reflection comes from: the static SA env texture, or a live sky probe. */
  source: 'sa-envmap' | 'sky-probe';
  /** Specular highlight model. */
  specular: 'off' | 'pbr' | 'sa-dot';
  /** How env-map coords/blend are computed: SA's camera-space sphere map, or three's PBR reflection. */
  technique: 'pbr-envmap' | 'sa-spheremap';
}

/** Built-in presets. Extend by adding an entry here (and, if desired, default to it in the config). */
export const PRESETS: Record<string, ReflectionPreset> = {
  // Our improved path: real timecyc-sky reflections via a sky cube probe + PBR (≈ Xbox "neo").
  // Low metalness keeps the painted look (dielectric Fresnel reflections, not chrome); reflectivity
  // pushes the env contribution so it reads. Tune in-browser via the REFLECT INTENSITY slider.
  enhanced: {
    clearcoat: 1, // glossy lacquer reflecting the sky; the saturated paint shows through underneath
    clearcoatRoughness: 0.15,
    label: 'Enhanced',
    metalness: 0,
    reflectivity: 0.4, // modest — the env map also adds diffuse sky ambient; higher washes upward faces out
    roughness: 0.6,
    source: 'sky-probe',
    specular: 'pbr',
    technique: 'pbr-envmap',
  },
  // Faithful original PC look: static SA env map via the camera-space sphere-map shader, subtle.
  PC: {
    clearcoat: 0,
    clearcoatRoughness: 0.2,
    label: 'PC',
    metalness: 0,
    reflectivity: 0.2, // additive SA sphere-map strength (× coefficient × intensity) — subtle, like the original
    roughness: 1,
    source: 'sa-envmap',
    specular: 'sa-dot',
    technique: 'sa-spheremap',
  },
  // Glossier console look: same SA sphere-map, clearly brighter/stronger than PC.
  PS2: {
    clearcoat: 0,
    clearcoatRoughness: 0.1,
    label: 'PS2',
    metalness: 0,
    reflectivity: 0.45,
    roughness: 1,
    source: 'sa-envmap',
    specular: 'sa-dot',
    technique: 'sa-spheremap',
  },
};
