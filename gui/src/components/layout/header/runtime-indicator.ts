import type { RuntimeKind } from "@/types/session";

export type RuntimeIndicator =
  | "hidden"
  | "configure-models"
  | "external-ready"
  | "external-unconfigured";

/**
 * Which engine (内核) state the MainHeader status cluster shows. Managed
 * runtime surfaces nothing once any model has a usable credential,
 * otherwise a "configure models" prompt; external runtime is "ready"
 * only when both the GA path and a Python interpreter are set,
 * otherwise "unconfigured".
 */
export function resolveRuntimeIndicator(
  runtimeKind: RuntimeKind,
  hasConfiguredManagedModel: boolean,
  gaConfig: { gaPath: string; python: string },
): RuntimeIndicator {
  if (runtimeKind === "managed") {
    return hasConfiguredManagedModel ? "hidden" : "configure-models";
  }
  return gaConfig.gaPath.trim() !== "" && gaConfig.python.trim() !== ""
    ? "external-ready"
    : "external-unconfigured";
}
