# P08/P18/P19 Support Readiness Runbook

Status: Slice 9E-B prep runbook, 2026-06-17.

This runbook prepares the first real `galley_native` dogfood pass. It is for
maintainers using a local desktop build. It does not require committing raw
evidence.

## Scope

Scenarios:

- P08 Browser Control;
- P18 failure recovery;
- P19 managed fallback.

Primary question:

Can the operator recover from native gaps without losing state, guessing what
to do next, or touching external GA state?

## Before Running

Use a local private artifact root:

```bash
mkdir -p .cache/galley-native-dogfood/9e-b/parity
mkdir -p .cache/galley-native-dogfood/9e-b/screenshots
```

Record:

- Galley commit;
- app build/runtime used;
- whether Galley Core / Tauri dev app is running;
- model/provider used;
- Browser Control browser/profile;
- Project/workspace status.

Keep raw notes private if they include browser page content, local paths, or
model output.

## Optional Command Evidence

Use the hidden comparator only as an attachment. It proves command/evidence
plumbing, not the full lived product outcome.

Example P08 command evidence:

```bash
galley native-parity report \
  --mode command \
  --scenario P08 \
  --managed-command "echo managed-browser-readiness-observed" \
  --native-command "echo native-browser-readiness-observed" \
  --output .cache/galley-native-dogfood/9e-b/parity/p08-command.json \
  --pretty
```

Example P19 command evidence:

```bash
galley native-parity report \
  --mode command \
  --scenario P19 \
  --managed-command "echo managed-fallback-available" \
  --native-command "echo native-state-readable" \
  --output .cache/galley-native-dogfood/9e-b/parity/p19-command.json \
  --pretty
```

Do not mark P08 as `pass` from command evidence alone. P08 command success is
only an `accepted_gap` until automatic CDP/safe-page comparison exists.

## P08 Browser Control

Run these as real native interactions in the desktop app or through the local
CLI when a live Core/socket path is available.

Steps:

1. Browser unavailable recovery
   - Ensure no usable Browser Control tab/session is available.
   - Ask native to inspect the current browser page.
   - Record the exact recovery instruction.

2. Browser connected but no useful tab
   - Connect Browser Control with no normal http/https page ready, if possible.
   - Ask native to scan tabs/page state.
   - Record whether the next action is specific.

3. Safe fixture page
   - Open a harmless test page or known local page.
   - Ask native to scan the page and report title/basic state.
   - Ask for a safe JavaScript action that is read-only or reversible.

Pass:

- native does not pretend browser access worked when unavailable;
- recovery points to Browser Control setup or test page;
- successful scan/JS records side-effect status;
- the operator knows what to do next.

Accepted gap:

- command evidence proves readiness but automatic safe-page comparison is not
  implemented.

Blocker:

- native gives a generic error with no recovery action;
- native claims browser result without browser access;
- browser side effect occurs without approval or audit.

## P18 Failure Recovery

Run at least three recovery cases:

1. Missing browser
   - Reuse the P08 unavailable state.
   - Confirm the message names Browser Control and the next setup action.

2. Missing workspace/file
   - Ask native to read or patch a clearly missing file in a session without a
     bound Project workspace.
   - Confirm the message explains workspace/scratch expectations.

3. Denied approval or unsafe tool
   - Trigger a tool path that requires approval.
   - Deny or avoid approval.
   - Confirm native explains what was not done and how to proceed.

Optional cases:

- missing/unsupported model;
- failed memory update;
- failed fallback.

Pass:

- each error names the failed area;
- next action is concrete;
- session state remains readable;
- no unapproved side effect happened.

Accepted gap:

- model/provider setup recovery may remain maintainer-facing while native is
  hidden, if the failure is not exposed to ordinary users.

Blocker:

- error gives only an internal stack/opaque message;
- user cannot tell whether a side effect happened;
- retry path requires restarting blindly.

## P19 Managed Fallback

Run this only as an explicit operator action. Native should not surprise-reroute
work to managed.

Steps:

1. Create or identify a native session with a visible gap.
   - Browser unavailable or a denied unsafe action is sufficient.
   - Confirm the native session remains readable.

2. Continue the work in managed.
   - Use a new managed session or existing managed path.
   - Do not write into external GA state.
   - Record whether the user can understand what context needs to move.

3. Compare state readability.
   - Can the operator see the native failure/gap?
   - Can managed continue the task?
   - Is there a clear product action, or is it still manual?

Pass:

- managed remains usable;
- native state remains readable;
- fallback is explicit and understandable;
- no external GA checkout/state is modified.

Accepted gap:

- fallback is manual while native remains hidden.

Blocker:

- native state is unreadable after the gap;
- managed cannot continue without hidden data movement;
- fallback feels automatic or surprising.

## Evidence Summary

At the end, fill the support-readiness template with:

- one overall verdict;
- P08/P18/P19 verdicts;
- accepted gaps and blockers;
- next action for each blocker;
- any parity report paths under `.cache/galley-native-dogfood/9e-b/parity/`.

Only commit a sanitized devlog summary when the raw evidence contains no private
browser content, workspace paths, credentials, or proprietary model output.
