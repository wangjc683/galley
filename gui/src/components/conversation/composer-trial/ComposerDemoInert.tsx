import type { MouseEvent, ReactNode } from "react";

function swallow(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

/**
 * TEMPORARY (ticket 24; see composer-trial.ts) — 「演示在跑」's queue
 * strip: drawn as usual, hover and all, but a click on it (edit, run
 * now, remove) stops here, before it reaches Core.
 */
export function ComposerDemoInert({ children }: { children: ReactNode }) {
  return (
    <div data-role="composer-trial-demo" onClickCapture={swallow}>
      {children}
    </div>
  );
}
