/** Top-level game configuration. Mutated in place so `PluginContext.config` stays live. */
export interface Config {
  debugMode: boolean;
  staticUrl: string;
}
