import { useEffect, type RefObject } from "react";

import { attachBubbleSpring } from "@/lib/bubble-spring-play";

/**
 * The main chat's rows lag a little behind your own scrolling and spring
 * back when you stop (main chat PRD ruling 201, ticket 150; rules in
 * lib/bubble-spring.ts, the page side in lib/bubble-spring-play.ts).
 * `enabled`: the main chat. Off, nothing is attached: the workbench, a
 * subtask opened from the assistant, the external runtime move not a
 * pixel. Nothing here renders: the spring writes styles, not state.
 */
export function useScrollSpring({
  enabled,
  scrollContainerRef,
}: {
  enabled: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    return attachBubbleSpring(container);
  }, [enabled, scrollContainerRef]);
}
