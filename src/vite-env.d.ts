/// <reference types="vite/client" />

/** Build version, injected from package.json by vite `define` (see vite.config.ts). */
declare const __APP_VERSION__: string;

/** True only in the deploy build (`build:prod`) — hides the dev-only debugger sections. */
declare const __DEBUGGER_HIDE__: boolean;

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ImportMetaEnv {
  /** Google Analytics measurement ID (e.g. `G-XXXXXXX`). Unset in dev → analytics is skipped. */
  /** Asset loader (`fetch` = manifest + chunk download, default | `local` = user-picked raw install). */
  readonly VITE_ASSET_LOADER?: string;
  readonly VITE_GA_ID?: string;
  /** Game variant to boot (`original` | `carcer`). Default `original`. */
  readonly VITE_GAME_TYPE?: string;
  /** TEMP: player ped model from `peds.ide` (e.g. `BMYPOL1`); unset → defaults to `BMYPOL1`. */
  readonly VITE_MAIN_CHARACTER?: string;
  readonly VITE_STATIC_URL: string;
  /** TEMP: vehicle models to make available, via `vehicles.ide` (e.g. `['admiral','comet']` or `admiral,comet`). */
  readonly VITE_VEHICLES?: string;
}

interface Window {
  dataLayer?: unknown[];
}
