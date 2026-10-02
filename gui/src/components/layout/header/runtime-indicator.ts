import type { RuntimeKind } from "@/types/session";

import type { SidebarRuntimeIndicator } from "./types";

/**
 * Which runtime-config nudge the sidebar header shows. Managed runtime
 * surfaces nothing once any model has a usable credential, otherwise a
 * "configure models" prompt; external runtime is "ready" only when both
 * the GA path and a Python interpreter are set, otherwise "unconfigured".
 */
export function resolveSidebarRuntimeIndicator(
  runtimeKind: RuntimeKind,
  hasConfiguredManagedModel: boolean,
  gaConfig: { gaPath: string; python: string },
): SidebarRuntimeIndicator {
  if (runtimeKind === "managed") {
    return hasConfiguredManagedModel ? "hidden" : "configure-models";
  }
  return gaConfig.gaPath.trim() !== "" && gaConfig.python.trim() !== ""
    ? "external-ready"
    : "external-unconfigured";
}
