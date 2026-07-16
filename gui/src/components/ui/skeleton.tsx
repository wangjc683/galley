import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

/**
 * Ghost block for content-shaped loading surfaces.
 *
 * Design contract (DESIGN.md §2.7): this is a functional liveness
 * indicator, not decoration — so it breathes gently instead of
 * shimmering (shimmer is the B-class noise the design system bans),
 * and it goes static under `prefers-reduced-motion`. Use it only
 * where real content will land in the same shape; action-busy states
 * (probe buttons, connect flows) keep the spinner.
 */
export function Skeleton({
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn("skeleton-breath rounded-sm bg-hover", className)}
      {...rest}
    />
  );
}
