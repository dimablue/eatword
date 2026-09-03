/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARENA_WS?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
