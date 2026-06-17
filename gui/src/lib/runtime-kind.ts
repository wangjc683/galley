import type { RuntimeKind } from "@/types/session";

export function isBuiltInRuntimeKind(kind: RuntimeKind): boolean {
  return kind === "managed" || kind === "galley_native";
}

export function runtimeUsesManagedModelConfig(kind: RuntimeKind): boolean {
  return isBuiltInRuntimeKind(kind);
}
