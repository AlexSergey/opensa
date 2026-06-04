/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_STATIC_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
