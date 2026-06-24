/**
 * Game-agnostic types for the vehicle optimizer. A standalone modding tool (output is valid SA DFF/COL, usable
 * in the real game) with two operations: **uniform scale** (geometry + the dummy rig + collision) and
 * **material-effect copy** (reflection / specular / env-map only) from a reference model. Game specifics live
 * behind {@link VehicleAdapter}.
 */

/** One material's reflective-effect presence (the only material data the copy touches). */
export interface MaterialReport {
  envMap: boolean;
  reflection: boolean;
  specular: boolean;
  texture: string;
}

/** What to do to one vehicle DFF. Both may be combined in a single run. */
export interface ProcessOptions {
  /** Reference vehicle DFF bytes to copy reflection/specular/env-map effects from (plan 003). */
  prototype?: Uint8Array;
  /** Uniform scale factor for geometry + frame rig + collision (plan 002); 1 / undefined = no scale. */
  scale?: number;
}

/** Per-game contract operating on DFF bytes (the CLI handles file I/O). */
export interface VehicleAdapter {
  /** Parse + report a vehicle DFF's structure (read-only). `name` labels the report. */
  inspect(dff: Uint8Array, name: string): VehicleReport;
  /** Scale and/or copy effects → a finished DFF byte buffer (plans 002/003). */
  process(dff: Uint8Array, options: ProcessOptions): Uint8Array;
}

/** Structure report — the parts/dummies scaling touches + the materials the effect-copy uses. */
export interface VehicleReport {
  /** Named frames (the rig: wheel/door/seat/light dummies, chassis_vlo, …). */
  dummies: string[];
  frames: number;
  geometries: number;
  materials: MaterialReport[];
  model: string;
  triangles: number;
  vertices: number;
}
