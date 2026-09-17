/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SHIM_URL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** package.json version, baked in by vite.config.ts. */
declare const __APP_VERSION__: string;
