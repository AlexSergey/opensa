/** Top-level game configuration. Mutated in place so `PluginContext.config` stays live. */
export interface Config {
  debugMode: boolean;
  /** Overlay collision (COL) wireframes on the current region (debug). */
  showCollision: boolean;
  staticUrl: string;
}
