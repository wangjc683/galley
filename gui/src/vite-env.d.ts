/// <reference types="vite/client" />

/**
 * Build-time constant injected by vite.config.ts `define`: the commit
 * date (YYYY-MM-DD) of the `v<version>` release tag, or null when the
 * tag doesn't exist (dev builds). Read via `@/lib/build-info`, not
 * directly — vitest runs without Vite defines.
 */
declare const __GALLEY_RELEASE_DATE__: string | null;
