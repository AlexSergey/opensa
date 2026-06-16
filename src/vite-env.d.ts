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
  readonly VITE_GA_ID?: string;
  /** Game variant to boot (`original` | `carcer`). Default `original`. */
  readonly VITE_GAME_TYPE?: string;
  readonly VITE_STATIC_URL: string;
}

interface Window {
  dataLayer?: unknown[];
}
