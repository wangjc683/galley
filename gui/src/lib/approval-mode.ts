/**
 * Per-session approval mode (自动执行 / 逐步审批).
 *
 * One session runs in exactly one of two modes:
 *   - "auto":     tools run without step approval (runner yolo flag on)
 *   - "approval": high-risk tools gate behind step approval
 *
 * A session may carry an explicit override (persisted in the sessions
 * table `approval_mode` column); otherwise it follows the app-wide
 * default (the legacy `yolo_mode` pref — true means "auto"). The
 * inheritance rule is "follow the default until explicitly overridden":
 * changing the default retargets every non-overridden session, while
 * overridden sessions stay pinned until the user picks 恢复跟随默认.
 *
 * This helper is the single place that resolves override + default into
 * the effective mode — the composer pill, the bridge `ready` sync, and
 * the default-change broadcast must all go through it so the three
 * call sites cannot drift.
 */
export type SessionApprovalMode = "auto" | "approval";

export function effectiveApprovalMode(
  override: SessionApprovalMode | null | undefined,
  defaultAuto: boolean,
): SessionApprovalMode {
  return override ?? (defaultAuto ? "auto" : "approval");
}
