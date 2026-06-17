import { useEffect } from "react";

import { isBuiltInRuntimeKind } from "@/lib/runtime-kind";
import { useBrowserControlStore } from "@/stores/browser-control";
import type { RuntimeKind } from "@/types/session";

export function useBrowserControlStartupEffect(
  activeRuntimeKind: RuntimeKind,
): void {
  const ensureBrowserControlLayout = useBrowserControlStore(
    (s) => s.ensureLayout,
  );
  const probeBrowserControl = useBrowserControlStore((s) => s.probe);

  useEffect(() => {
    if (!isBuiltInRuntimeKind(activeRuntimeKind)) return;
    let cancelled = false;
    void (async () => {
      const layout = await ensureBrowserControlLayout();
      if (cancelled) return;
      if (!layout) return;
      await probeBrowserControl("startup");
    })();
    return () => {
      cancelled = true;
    };
  }, [activeRuntimeKind, ensureBrowserControlLayout, probeBrowserControl]);
}
