import type { MeshIR } from './ir';

/** The unit flowing through the pipeline (Gulp "vinyl"-like). Plugins mutate `ir` and set `dirty`. */
export interface Asset {
  /** True once a plugin mutated `ir` — tells the adapter to re-serialize (vs identity-copy the source). */
  dirty: boolean;
  /** Editable geometry the plugins operate on. */
  ir: MeshIR;
  /** Diagnostics + applied transforms, appended via `PipelineContext.log`. */
  log: LogEntry[];
  /** Scratch space for plugins to pass data along the pipeline. */
  meta: Record<string, unknown>;
  /** Model id / base name. */
  name: string;
  /** Original, untouched source bytes (for the identity write + raw passthrough). */
  source: Uint8Array;
}

/** A model the adapter found in the game's map — the unit before it is loaded. */
export interface AssetRef {
  /** Model id / base name, e.g. `des_logcabin`. */
  name: string;
}

/** One entry in an asset's transform log (diagnostics + before/after notes). */
export interface LogEntry {
  message: string;
  plugin: string;
}

/** A pipeline stage. Mutates the asset's IR in place (or skips). Order in the config is significant. */
export interface MapPlugin {
  /** Restrict the plugin to matching assets (default: applies to all). */
  accepts?(asset: Asset): boolean;
  /** Unique stage name (shown in the report + logs). */
  name: string;
  /** Transform the asset in place; set `asset.dirty = true` if `ir` changed. */
  transform(asset: Asset, context: PipelineContext): Promise<void> | void;
}

/** Pipeline definition (the "gulpfile"): ordered plugins + I/O options. */
export interface OptimizerConfig {
  /** Parallel asset workers (default 4). */
  concurrency?: number;
  /** Ordered transform stages. */
  plugins: MapPlugin[];
}

/** Shared context handed to every plugin. */
export interface PipelineContext {
  /** The game id being processed (the `--game` argument). */
  game: string;
  /** Append a diagnostic to an asset's log under the given plugin name. */
  log(asset: Asset, plugin: string, message: string): void;
}

/** The serialized result the core writes to the output directory. */
export interface WriteResult {
  bytes: Uint8Array;
  fileName: string;
}
