export type ProjectScopePhase = "entering" | "entered" | "exiting";

export type SidebarAttention =
  | "none"
  | "error"
  | "ask_user"
  | "approval"
  | "unread";

/** Unmount timers for the two sidebar-mode presences. Contract: must
 * exceed the exiting transition's duration (--motion-base, 160ms) plus
 * a settle margin, or the unmount clips the tail of the exit animation
 * — PROJECT_REVIEW_EXIT_MS sat at 150ms and cut the last 10ms until
 * 2026-08-12. Same duration-plus-margin shape as RunFoldSection's
 * unmount delay. */
export const GLOBAL_TIMELINE_EXIT_MS = 200;

export const PROJECT_REVIEW_EXIT_MS = 200;

export const PROJECT_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Fallback "now" for the 7-day active window. A function, not a
 * module-load constant: a desktop app left running for days would
 * otherwise classify against a stale clock. */
export const projectReviewFallbackNowMs = () => Date.now();


export type SidebarRuntimeIndicator =
  | "hidden"
  | "configure-models"
  | "external-ready"
  | "external-unconfigured";

export type RuntimeIndicatorView = {
  label: string;
  title: string;
  ariaLabel: string;
  tone: "success" | "muted";
  action?: "models" | "runtime";
};
