# Galley Native Parity Comparator Report

Status: Slice 9D-D Browser/fallback command evidence landed, 2026-06-17.

This document defines the managed-vs-native comparison report shape and the
hidden local writers. The default writer does not run GenericAgent, start
native sessions, add schema, or expose UI. The command writer runs only
operator-supplied commands.

## Purpose

The comparator exists to answer one product question:

Can `galley_native` complete the same user-visible workflow as `managed_ga`
without losing safety, state, recovery, or operator clarity?

It is not a benchmark for prettier wording, faster tokens, provider internals,
or Rust-vs-Python implementation details.

## First Scenario Batch

Slice 9D should start with scenarios that already have native harness coverage
or clear safe integration paths:

| ID | Why First | Comparator Shape |
|---|---|---|
| P01 | Basic no-tool answer is the smallest replacement proof | Compare final outcome and event rhythm |
| P03 | `code_run` is core GA parity and approval-sensitive | Compare approval, command result, progress, final use of output |
| P04 | File edit is the highest-risk everyday local workflow | Compare preview quality, write safety, final changed file |
| P08 | Browser Control is product-critical and failure-prone | Compare ready/unavailable states, safe scan/JS result, recovery hints |
| P14 | Copy-to-native is the safest migration path | Compare source immutability and copied visible context |
| P18 | Failure recovery determines user trust | Compare next-step guidance for missing model/workspace/browser |
| P19 | Fallback keeps default switch reversible | Compare managed usability and data readability after native gap |

Do not start with Goal Hive or Morphling in 9D. Those need dogfood evidence in
9E before semantic comparison can be trusted.

## Verdicts

Every scenario report has exactly one verdict:

| Verdict | Meaning |
|---|---|
| `pass` | Native satisfies the same user-visible outcome and safety policy as managed |
| `fail` | Native regresses outcome, safety, state, or recovery |
| `accepted_gap` | Difference is known, documented, user-safe for the current rollout phase, and linked to follow-up |
| `blocked` | Scenario could not run for an environmental reason |
| `not_run` | Scenario is defined but not attempted in this report |

`accepted_gap` is not a softer `pass`. It must explain why the gap is safe for
the current phase and what would make it unacceptable later.

## Comparison Dimensions

Compare these dimensions:

- `outcome`: did the user-visible task succeed, fail clearly, or ask for the
  right next input?
- `tool_action`: same class of tool/action, not necessarily identical internal
  call sequence;
- `event_rhythm`: comparable stream shape for operators and Supervisors;
- `approval`: same or safer pause/preview/decision behavior;
- `side_effects`: filesystem/browser/process/memory effects match what the user
  approved;
- `memory_policy`: native does not write external GA state and uses Galley-owned
  memory rules;
- `workspace_policy`: native uses explicit Project/scratch roots, not process
  cwd assumptions;
- `recovery`: errors name the problem and next action;
- `persisted_state`: session messages, tool records, approvals, and copied
  context remain readable.

Do not compare exact prose, token counts, internal stack traces, GA file names,
or provider-specific payloads.

## Report Shape

The first report format is local JSON. It is an internal harness artifact, not
the public Agent API.

```json
{
  "reportVersion": 1,
  "generatedAt": "2026-06-17T00:00:00Z",
  "galleyCommit": "unknown",
  "scenarioId": "P04",
  "scenarioTitle": "File edit",
  "verdict": "accepted_gap",
  "phaseGate": "beta-blocker",
  "harness": "managed_native_comparison",
  "managed": {
    "runtimeKind": "managed",
    "model": "Claude Sonnet 4",
    "command": "galley session new ...",
    "events": ["turn_start", "tool_pending", "approval_pending", "tool_end", "turn_end"],
    "tools": [
      {
        "name": "file_patch",
        "status": "success",
        "approval": "risk_based",
        "sideEffectsPerformed": true
      }
    ],
    "finalOutcome": "Patched notes.txt and reported the changed file.",
    "persistedState": ["visible user turn", "visible assistant turn", "tool audit"]
  },
  "native": {
    "runtimeKind": "galley_native",
    "model": "Claude Sonnet 4",
    "command": "GALLEY_NATIVE_EXPERIMENTAL=1 galley session new ...",
    "events": ["runtime_ready", "turn_start", "tool_pending", "approval_pending", "tool_end", "turn_end", "run_complete"],
    "tools": [
      {
        "name": "file_patch",
        "status": "success",
        "approval": "risk_based",
        "sideEffectsPerformed": true
      }
    ],
    "finalOutcome": "Patched notes.txt and reported the changed file.",
    "persistedState": ["visible user turn", "visible assistant turn", "tool audit"]
  },
  "comparison": {
    "outcome": "match",
    "toolAction": "match",
    "eventRhythm": "accepted_gap",
    "approval": "match",
    "sideEffects": "match",
    "memoryPolicy": "match",
    "workspacePolicy": "match",
    "recovery": "not_applicable",
    "persistedState": "match"
  },
  "acceptedGaps": [
    {
      "dimension": "eventRhythm",
      "reason": "Native emits runtime_ready/run_complete around the same workflow.",
      "phaseLimit": "Allowed for dogfood because stream fields are additive.",
      "followUp": "No action unless Supervisor dogfood finds parser friction."
    }
  ],
  "blockers": [],
  "notes": "Human-readable summary for review."
}
```

## Required Fields

Each report must include:

- `reportVersion`;
- `generatedAt`;
- `galleyCommit`;
- `scenarioId`;
- `verdict`;
- `phaseGate`;
- `harness`;
- `managed.runtimeKind`;
- `native.runtimeKind`;
- `managed.events`;
- `native.events`;
- `comparison`;
- `acceptedGaps`;
- `blockers`.

If a runtime cannot run, keep its object present and explain the blocker. Do not
drop the missing side.

## Safety Rules

- The comparator must never write into external GA state.
- Managed runs use only Galley-owned managed runtime state.
- File scenarios use temporary workspaces.
- Browser scenarios use safe read-only pages or explicitly reversible test
  pages.
- Fallback scenarios must not delete native data.
- Reports may include command output, but must redact credentials and local
  secrets.

## First Runner Boundary

The first runner should:

- read a scenario definition;
- create isolated temp workspace/state;
- run managed and native commands when their prerequisites exist;
- collect NDJSON stream frames and final session state;
- write the JSON report above;
- exit non-zero only for harness failure, not for a scenario verdict of `fail`.

The first runner should not:

- ask a model to judge parity;
- compare exact assistant prose;
- require a real browser for non-browser scenarios;
- mutate external GA checkouts;
- expose reports in Settings.

## Hidden Fixture Writer

Slice 9D-B added a hidden CLI harness:

```bash
galley native-parity report --output /tmp/galley-native-parity.json --pretty
```

It is intentionally not part of the public Agent API. Ordinary `galley --help`
hides it.

Behavior:

- default selection is the full first batch: P01, P03, P04, P08, P14, P18,
  and P19;
- repeat `--scenario <ID>` to narrow the report;
- omit `--output` to print the report JSON array to stdout;
- with `--output`, the command writes the JSON array to that path and prints a
  small JSON summary;
- verdicts are derived from comparison dimensions, accepted gaps, and blockers,
  not hand-filled per scenario.

The first fixture bundle is evidence-shape coverage, not live managed/native
execution. It lets reviewers inspect the exact report contract and risk labels
before model, runtime, and Browser Control variance enters the loop.

Current fixture verdict intent:

| ID | Fixture Verdict Intent |
|---|---|
| P01 | `accepted_gap` because native has additive runtime envelope events |
| P03 | `accepted_gap` until real command progress parity is captured |
| P04 | `accepted_gap` until real temp-workspace patch parity is captured |
| P08 | `blocked` because fixture mode does not launch CDP or a safe page |
| P14 | `pass` for copy-to-native source immutability and copied context shape |
| P18 | `accepted_gap` until real recovery categories are compared |
| P19 | `accepted_gap` because fallback is manual while native is hidden beta |

## Explicit Command Mode

Slice 9D-C added a second hidden mode, and Slice 9D-D extended it to Browser
and fallback evidence:

```bash
galley native-parity report \
  --mode command \
  --scenario P14 \
  --managed-command "galley session show <managed-session>" \
  --native-command "galley session copy-to-native <managed-session>" \
  --output /tmp/galley-native-command-parity.json \
  --pretty
```

This is a bridge between fixture reports and a future automatic managed/native
runner. It executes only commands the operator passes explicitly. It does not
invent default managed GA prompts, start Browser Control, open Core sockets on
its own, or mutate external GA state except through whatever the operator's
explicit command does.

Command-mode behavior:

- requires exactly one `--scenario`;
- currently supports the first 9D batch: P01, P03, P04, P08, P14, P18, and
  P19;
- requires both `--managed-command` and `--native-command`;
- runs each side in an isolated workspace root with `managed/` and `native/`
  subdirectories;
- sets `GALLEY_PARITY_RUNTIME` and `GALLEY_PARITY_WORKSPACE` for each command;
- creates a temp workspace by default and removes it when the command exits;
- preserves an explicit `--workspace` path;
- captures `exitCode`, timeout status, stdout/stderr previews, duration, and
  workspace path under `managed.commandStatus` and `native.commandStatus`;
- does not compare exact stdout text as the parity judge.

Command-mode verdict rules:

| Situation | Verdict |
|---|---|
| managed succeeds and native succeeds | inherits the scenario's semantic fixture verdict |
| P08 managed/native readiness commands both succeed | `accepted_gap`, because this proves operator-supplied Browser readiness evidence, not automatic Browser Control parity |
| managed fails or times out | `blocked`, because the baseline is unavailable |
| managed succeeds and native fails or times out | `fail`, because native regressed the explicit comparison |

The command mode is still not a full live GA runner. It is useful for local
evidence capture and for proving the report writer can ingest real process
results before model/browser-dependent automation is added.

For P08, command mode replaces the fixture-only blocker with a human-reviewable
Browser readiness accepted gap when both commands succeed. It still does not
launch CDP, serve a safe page, or compare browser DOM/JS results on its own.

For P19, command mode records explicit managed fallback/native readability
commands while preserving the rollout gap: fallback is still manual while native
is hidden beta.

## Relationship To Later Slices

- Slice 9D-A: this report contract.
- Slice 9D-B: first local report writer with fixture scenarios; landed as the
  hidden `native-parity report` command.
- Slice 9D-C: explicit managed/native command mode for P01, P03, P04, P14,
  and P18.
- Slice 9D-D: Browser and fallback command evidence for P08 and P19; automatic
  CDP/safe-page and fallback-flow presets are still later beta gates.
- Slice 9E: dogfood evidence and troubleshooting.
- Slice 9F: Settings opt-in after beta blockers pass or have accepted gaps.
