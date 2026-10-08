import type { RuntimeKind } from "@/types/session";

export type RuntimeIndicator =
  | "hidden"
  | "configure-models"
  | "external-ready"
  | "external-unconfigured";

/**
 * The synchronous half of "is the external GA usable": a GA folder is
 * set. Shared by the MainHeader engine indicator and Settings → 运行环境
 * so both read "available" the same way. Python is deliberately not
 * part of it — spawns default to the bundled interpreter and fall back
 * to `python3` / `python` when the field is blank, so an empty value
 * never blocks a session. Settings additionally checks that the folder
 * still exists on disk (async, only while 接入外部 GA is open); the
 * header has no such check.
 */
export function isExternalGAConfigured(gaConfig: { gaPath: string }): boolean {
  return gaConfig.gaPath.trim() !== "";
}

/**
 * Which engine (内核) state the MainHeader status cluster shows. Managed
 * runtime surfaces nothing once any model has a usable credential,
 * otherwise a "configure models" prompt; external runtime is "ready"
 * once a GA folder is set (`isExternalGAConfigured`), otherwise
 * "unconfigured".
 */
export function resolveRuntimeIndicator(
  runtimeKind: RuntimeKind,
  hasConfiguredManagedModel: boolean,
  gaConfig: { gaPath: string },
): RuntimeIndicator {
  if (runtimeKind === "managed") {
    return hasConfiguredManagedModel ? "hidden" : "configure-models";
  }
  return isExternalGAConfigured(gaConfig)
    ? "external-ready"
    : "external-unconfigured";
}
