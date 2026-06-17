# Galley Native Dogfood Evidence And Troubleshooting

Status: Slice 9E-A local evidence format, 2026-06-17.

This document defines how maintainers record real-use `galley_native` evidence
before Settings opt-in or default-switch decisions. It does not add telemetry,
runtime behavior, UI, schema, or automatic fallback.

## Purpose

Dogfood evidence answers a different question from tests:

Can a real operator complete the native workflow, understand failures, recover,
and safely continue work?

Automated parity reports prove shape and regression boundaries. Dogfood proves
the lived product path: Browser readiness, memory confidence, continuation,
Goal Hive usefulness, Morphling usefulness, failure recovery, and managed
fallback.

## Evidence Scope

Slice 9E focuses on the scenarios that need real desktop context or support
readiness before native can become visible:

| ID | Area | Why Dogfood Is Required |
|---|---|---|
| P08 | Browser Control | Browser readiness, safe JS, and recovery are environment-sensitive |
| P10 | Memory write | Users need trust, evidence, inspectability, and undo |
| P13 | Continue | Restart recovery requires real app/Core lifecycle confidence |
| P16 | Goal Hive | Usefulness is not captured by task-board mechanics alone |
| P17 | Morphling | Same-test absorption needs judgment about scope and safety |
| P18 | Failure recovery | Support quality is the user-facing outcome |
| P19 | Managed fallback | Rollback must preserve readable state and operator control |

## Local Evidence Record

Use one local markdown record per dogfood pass. It may live in a devlog entry
when non-sensitive, or in an uncommitted local note when it includes private
workspace names, browser pages, model outputs, or secrets.

```markdown
# Galley Native Dogfood Evidence: <scope>

Date:
Operator:
Galley commit:
Build/runtime:
Native gate state:
Model/provider:
Workspace:
Browser/profile:
Related parity reports:

## Summary

- Overall verdict: pass | fail | accepted_gap | blocked | not_run
- User impact:
- Biggest risk:
- Next action:

## Scenario Results

| ID | Verdict | Evidence | Accepted Gap / Blocker | Next Action |
|---|---|---|---|---|
| P08 | not_run |  |  |  |
| P10 | not_run |  |  |  |
| P13 | not_run |  |  |  |
| P16 | not_run |  |  |  |
| P17 | not_run |  |  |  |
| P18 | not_run |  |  |  |
| P19 | not_run |  |  |  |

## Recovery Notes

- Model:
- Browser:
- Workspace:
- Approval:
- Memory:
- Fallback:

## Attachments / References

- Parity report path:
- Screenshot path:
- Session id(s):
- Devlog link:
```

## Verdict Rules

- `pass`: the workflow completed and the recovery/fallback story is clear.
- `fail`: native regressed the user outcome, safety, state, or recovery.
- `accepted_gap`: the gap is documented, safe for the current hidden/beta
  phase, and has a concrete follow-up.
- `blocked`: environment or prerequisites prevented the run.
- `not_run`: scenario was not attempted in this pass.

Accepted gaps are not passes. They allow limited rollout only when the user is
not exposed to surprising state loss, unsafe side effects, or dead-end errors.

## Scenario Checklists

### P08 Browser Control

Run:

- browser unavailable recovery;
- browser connected with no useful tabs;
- safe fixture page scan;
- safe JavaScript action with reversible or read-only effect;
- Browser command evidence report when available.

Pass signal:

- native names the browser problem and next action;
- successful scan/JS records side-effect status;
- user can recover without restarting Galley blindly.

Accepted gaps:

- command evidence may be `accepted_gap` until automatic CDP/safe-page runner
  exists;
- browser setup copy may remain maintainer-facing while native is hidden.

### P10 Memory Write

Run:

- propose a low-risk memory update with evidence;
- inspect the typed memory row;
- undo or supersede the update;
- confirm no external GA memory is written.

Pass signal:

- native distinguishes durable memory from task/session state;
- evidence and source are visible;
- undo is understandable.

Accepted gaps:

- no polished memory UI is acceptable while hidden if the ledger is inspectable
  through Core/local tools.

### P13 Continue

Run:

- start a native session with visible progress;
- restart app/Core or simulate runner interruption;
- continue the session;
- verify messages, checkpoint, approvals, and session status.

Pass signal:

- the user sees what survived;
- continuation does not replay unsafe side effects;
- missing checkpoint recovery names the next action.

### P16 Goal Hive

Run:

- create a small native Goal with two or more worker tasks;
- verify task-board state is Core-owned;
- inspect worker materialization and final synthesis;
- confirm Goal protocol state is not stored in native memory.

Pass signal:

- final synthesis is useful, not just mechanically complete;
- stalled workers have clear recovery;
- operator can understand current Goal state.

### P17 Morphling

Run:

- choose a small toy CLI/library target;
- lock the target and objective;
- run same-test evidence;
- accept, reject, or emit a disabled candidate with reasons.

Pass signal:

- output includes target lock, component strategy, and same-test evidence;
- unsafe or unnecessary absorption is rejected clearly;
- no capability is activated without approval.

### P18 Failure Recovery

Run:

- missing model;
- missing workspace;
- browser unavailable;
- denied approval;
- failed memory write;
- failed fallback.

Pass signal:

- the message says what failed and what the user can do next;
- recovery does not corrupt session state;
- support docs match the observed error.

### P19 Managed Fallback

Run:

- encounter a native gap or user-rejected native path;
- preserve readable native state;
- continue the task in managed without mutating external GA;
- record whether copy/manual fallback is clear.

Pass signal:

- managed remains usable;
- source native data is readable;
- fallback is explicit, not surprising automatic reroute.

Accepted gaps:

- manual fallback is acceptable while native is hidden;
- before Settings opt-in, the product needs a designed user action and copy.

## Troubleshooting Matrix

| Area | Symptom | Likely Cause | Next Action |
|---|---|---|---|
| Model | Native cannot start or produces no assistant turn | model adapter/config unavailable | Verify configured model, provider key, and native adapter support; retry with a known working managed model |
| Browser | Browser tool says unavailable | no browser bridge/profile/page ready | Open supported browser, attach Browser Control, then rerun P08 safe-page check |
| Workspace | File/code tool refuses path | no Project workspace or scratch root | Bind a Project workspace or use the explicit temp workspace from the report |
| Approval | Turn stalls on tool call | approval pending or denied | Resolve the exact approval id; rerun only after confirming side effect |
| Memory | Memory update is missing or untrusted | no evidence, wrong scope, or update rejected | Inspect the native memory ledger; add evidence or undo/supersede the row |
| Continue | Session resumes without context | checkpoint/history not restored | Check visible messages, working checkpoint, and session status before sending new work |
| Goal Hive | Workers finish but synthesis is weak | task result materialization insufficient | Inspect task board and deliverable anchor before another wave |
| Morphling | Candidate looks unsafe or vague | target/objective/test not locked | Reject or keep disabled; rerun with locked target and same-test command |
| Fallback | Managed continuation is unclear | no explicit fallback action or copied context | Use copy/manual fallback, record data readability, and do not auto-reroute |

## Privacy Rule

Dogfood evidence stays local unless explicitly summarized. Do not add remote
telemetry for Slice 9E. When committing evidence, remove credentials, private
workspace paths, browser page contents, and proprietary model output.

## Relationship To Parity Reports

Use Slice 9D reports as attachments, not as a substitute for dogfood judgment.

- parity report: structured managed-vs-native evidence;
- dogfood record: real operator outcome, recovery, support clarity, and rollout
  decision.

The same scenario can have a passing parity report and still fail dogfood if
the recovery copy leaves the user stuck.
