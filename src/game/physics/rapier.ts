import RAPIER from '@dimforge/rapier3d-compat';

/** The initialised Rapier module (namespace of `World`, `RigidBodyDesc`, …). */
export type Rapier = typeof RAPIER;

/**
 * Initialise the Rapier physics engine.
 *
 * The `-compat` build ships its WASM inline but must be initialised once before
 * any `World`/`RigidBody` is created. The init promise is cached so repeated
 * calls (and React StrictMode double-mounts) share a single initialisation, and
 * the resolved value is the `RAPIER` module itself.
 */
let ready: null | Promise<typeof RAPIER> = null;

export function initRapier(): Promise<typeof RAPIER> {
  // NB `rapier3d-compat@0.19` logs a harmless "using deprecated parameters for the initialization
  // function" warning from its own WASM glue — upstream issue, fixed by upgrading the dependency.
  ready ??= RAPIER.init().then(() => RAPIER);

  return ready;
}
