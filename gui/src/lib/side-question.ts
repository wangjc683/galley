/**
 * The `/btw` side-question predicate — the GUI mirror of the bridge's
 * authoritative check (runner/workbench_bridge.py, `dispatch_command`'s
 * UserMessageCommand branch: lstrip, then exactly `/btw`, `/btw `, or
 * `/btw\t`).
 *
 * One module, both callers: the Composer's stop-gate decides whether a
 * draft may pass while the agent runs, and useMessageSend decides
 * whether the send takes the side-question path. Those two decisions
 * and the bridge's routing must agree — a draft the stop gate lets
 * through but the send hook routes as a main-agent turn lands
 * `put_task` on a running agent, which is exactly what `/btw` exists to
 * avoid. (Before 2026-07-27 the two GUI copies disagreed on the tab
 * form; keep any change here in lockstep with the bridge predicate.)
 */
export function isSideQuestion(text: string): boolean {
  const t = text.trimStart();
  return t === "/btw" || t.startsWith("/btw ") || t.startsWith("/btw\t");
}
