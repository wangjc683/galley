/**
 * Build-time facts baked in by vite.config.ts `define`.
 *
 * The typeof guard is load-bearing: vitest bundles without Vite's
 * define map, so the bare identifier would throw a ReferenceError
 * there. Everything in the app reads this module, never the raw
 * `__GALLEY_*` globals.
 */

/**
 * Commit date (YYYY-MM-DD) of this version's `v<version>` release tag,
 * or null in dev builds where the tag doesn't exist yet.
 */
export const RELEASE_DATE: string | null =
  typeof __GALLEY_RELEASE_DATE__ === "undefined"
    ? null
    : __GALLEY_RELEASE_DATE__;
