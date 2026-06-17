# Galley Native Parity Comparator Report

Status: Slice 9D-A report-contract checkpoint, 2026-06-17.

This document defines the managed-vs-native comparison report shape before a
runner exists. It does not run GenericAgent, start native sessions, add schema,
or expose UI.

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
| P19 | Fallback keeps opt-in beta reversible | Compare managed usability and data readability after native gap |

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
      "phaseLimit": "Allowed for opt-in beta because stream fields are additive.",
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

## Relationship To Later Slices

- Slice 9D-A: this report contract.
- Slice 9D-B: first local report writer with fixture scenarios.
- Slice 9D-C: managed/native command runner for P01, P03, P04, P14, P18.
- Slice 9D-D: browser and fallback scenarios P08 and P19.
- Slice 9E: dogfood evidence and troubleshooting.
- Slice 9F: Settings opt-in after beta blockers pass or have accepted gaps.
