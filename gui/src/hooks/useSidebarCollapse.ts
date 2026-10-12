import { useEffect } from "react";

import { useSidebarCollapseStore } from "@/stores/sidebar-collapse";

/**
 * The sidebar's collapse for App (main chat ticket 08): collapsed only
 * while there is a main chat — the external runtime's sidebar never
 * collapses, whatever is stored. The stored choice is read once at
 * mount, ahead of the main chat's arrival, so a launch into a collapsed
 * sidebar shows the sidebar as briefly as possible.
 */
export function useSidebarCollapse(hasMainChat: boolean): {
  collapsed: boolean;
  toggle: () => void;
} {
  const collapsed = useSidebarCollapseStore((s) => s.collapsed);
  const toggle = useSidebarCollapseStore((s) => s.toggle);
  const hydrate = useSidebarCollapseStore((s) => s.hydrate);
  useEffect(() => {
    void hydrate();
  }, [hydrate]);
  return { collapsed: hasMainChat && collapsed, toggle };
}
