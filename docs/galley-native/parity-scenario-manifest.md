# Galley Native Parity Scenario Manifest

Status: Slice 9A contract checkpoint, 2026-06-17.

This document defines what evidence is required before `galley_native` can move
from hidden dogfood to opt-in beta, and later from opt-in beta to the default
built-in runtime.

It does not implement tests, runtime behavior, UI, telemetry, or fallback
routing.

## Purpose

`galley_native` should replace `managed_ga` only when it preserves the user
outcomes that made the built-in GenericAgent path valuable:

- direct answers without tool noise;
- reliable local file and command work;
- clear approval pauses and recovery;
- browser control;
- useful memory and capability resources;
- workspace/session continuity;
- Goal Hive and Morphling;
- CLI/Supervisor stream compatibility;
- a tested fallback path.

Parity is product parity, not source parity and not word-for-word model parity.

## Runtime Terms

- `runtime`: execution engine for a session or Goal. Current values are
  `managed_ga`, `external_ga`, and `galley_native`.
- `Project`: Galley product object that may bind a main workspace.
- `workspace`: the filesystem root or scratch root native tools use.
- `memory`: Galley-owned typed memory state, exposed to native as read-only
  `memory://` resources plus approved updates.
- `Goal`: Core-owned task-board protocol for multi-worker execution.
- `scenario`: one user-visible workflow used as parity evidence.
- `harness`: the layer that runs or records the scenario.
- `accepted gap`: a known difference that is documented, user-safe, and not a
  blocker for the current rollout phase.

## Comparison Rules

Compare:

- final outcome class;
- tool/action class;
- event timeline shape;
- approval decision and preview quality;
- memory read/write policy;
- workspace/session persistence;
- recovery behavior;
- user-facing next-step guidance;
- persisted state and audit trail.

Do not compare:

- exact assistant wording;
- exact token counts;
- exact Python/Rust call stack;
- GA file names or cwd hacks;
- provider-specific request payloads;
- internal prompt wording unless it changes user-visible behavior.

## Harness Layers

| Layer | Meaning | Used For |
|---|---|---|
| `unit` | Deterministic Rust test of one function/policy | parsing, policy, resource path, validators |
| `mock_native` | Scripted native model loop without provider variance | event rhythm, tool loop, approval/ask-user, continuation |
| `native_integration` | Native runtime with real Core DB and safe local executors | CLI/socket behavior, persistence, file/code/browser safe paths |
| `managed_native_comparison` | Same scenario run through managed and native, compared semantically | replacement confidence and regression detection |
| `dogfood` | Human-reviewed run with real model and real desktop context | browser, Goal Hive, Morphling, subjective usefulness |

## Gate Classes

| Gate | Required Before | Meaning |
|---|---|---|
| `beta-blocker` | Visible Settings opt-in | Must pass or have a documented accepted gap before advanced users can opt in |
| `default-blocker` | New-user default switch | Must pass without user-hostile gaps before native becomes default |
| `dogfood-evidence` | Default switch review | Needs real-use evidence; automation alone is not enough |
| `support-readiness` | Opt-in beta and default switch | Error messages, docs, and fallback path must guide the next action |

No scenario may be marked passed because "native compiled" or because one
manual demo succeeded.

## Required Scenarios

| ID | Area | Scenario | Harness | Gate | Pass Signal |
|---|---|---|---|---|---|
| P01 | Basic answer | Answer a normal question without tools | `mock_native`, `native_integration`, `managed_native_comparison` | `beta-blocker` | native returns a useful final answer, clean event sequence, no fake tool claim |
| P02 | Model adapters | Run no-tool turns through supported OpenAI-compatible and Anthropic-compatible records | `unit`, `mock_native`, `native_integration` | `beta-blocker` | provider responses normalize into the same run/event contract |
| P03 | `code_run` | Run a small command and use stdout/stderr/exit status correctly | `mock_native`, `native_integration`, `managed_native_comparison` | `beta-blocker` | approval, execution, progress, result, and continuation are visible |
| P04 | File edit | Read and patch a temp project file | `mock_native`, `native_integration`, `managed_native_comparison` | `beta-blocker` | preview-first approval, exact-match write, final answer names changed file |
| P05 | Large code no-tool | Recover when model emits large code without a tool call | `mock_native`, `managed_native_comparison` | `default-blocker` | native preserves answer or correction path without corrupting state |
| P06 | Approval | Block, allow, deny, and resume risky work | `mock_native`, `native_integration` | `beta-blocker` | pending approval is durable; allow/deny resolves the exact call once |
| P07 | Ask user | Suspend on `ask_user` and resume on the next user answer | `mock_native`, `native_integration` | `beta-blocker` | session status, event stream, and final answer survive the pause |
| P08 | Browser | Scan tabs and execute a safe JavaScript action | `native_integration`, `managed_native_comparison`, `dogfood` | `beta-blocker`, `dogfood-evidence` | browser unavailable/connected/no-tabs states guide recovery; successful JS records side-effect status |
| P09 | Memory read | Discover an SOP through an L1 pointer and read the resource | `unit`, `mock_native`, `native_integration` | `beta-blocker` | native uses `memory://` via `file_read` without adding a bespoke memory-read tool |
| P10 | Memory write | Distill a verified low-risk fact with evidence and undo it | `unit`, `mock_native`, `native_integration`, `dogfood` | `default-blocker`, `dogfood-evidence` | memory change is typed, evidenced, inspectable, and reversible |
| P11 | Capability pack | Use built-in pack SOP/test resources without executing scripts directly | `unit`, `mock_native`, `native_integration` | `beta-blocker` | `capability://` reads work; direct script execution is blocked |
| P12 | Workspace | Resolve explicit workspace root, scratch fallback, and file mentions | `unit`, `mock_native`, `native_integration` | `beta-blocker` | native does not depend on process cwd and gives clear missing-workspace recovery |
| P13 | Continue | Restore and continue after app/Core restart | `native_integration`, `dogfood` | `default-blocker` | visible history, working checkpoint, approvals, and session status recover correctly |
| P14 | Copy continue | Copy a managed or occupied session into native safely | `native_integration`, `managed_native_comparison` | `beta-blocker` | source session is not mutated; native copy has visible context and correct runtime |
| P15 | CLI/Supervisor | Preserve schema v1 and stream compatibility for `galley_native` | `unit`, `native_integration` | `beta-blocker` | old callers can ignore optional fields and handle `runtimeKind=galley_native` |
| P16 | Goal Hive | Run a small multi-worker Goal to final synthesis | `mock_native`, `native_integration`, `dogfood` | `default-blocker`, `dogfood-evidence` | Core owns task board; workers materialize results; final synthesis is useful |
| P17 | Morphling | Absorb or reject a toy CLI/library using same-test comparison | `mock_native`, `native_integration`, `dogfood` | `default-blocker`, `dogfood-evidence` | output includes target lock, component strategy, same-test evidence, and disabled candidate if any |
| P18 | Failure recovery | Surface missing model/workspace/browser/tool errors clearly | `unit`, `mock_native`, `native_integration`, `dogfood` | `support-readiness` | message names the problem and gives the next recovery action |
| P19 | Managed fallback | Route a failed or user-rejected native path back to managed without data loss | `native_integration`, `managed_native_comparison`, `dogfood` | `beta-blocker`, `support-readiness` | managed remains usable, source data is readable, and external GA is untouched |

## Accepted Variance

Allowed:

- different wording with the same user outcome;
- different but equivalent tool ordering when approvals and side effects remain
  correct;
- native refusing an unsafe action that managed attempts, if the refusal gives a
  usable recovery path;
- native using Galley-owned memory/resources instead of GA file state;
- native using explicit workspace roots instead of implicit cwd.

Not allowed:

- claiming a tool was used when it was not;
- skipping required approval;
- writing external GA state;
- silently losing session history or memory state;
- exposing native as stable while managed fallback is untested;
- treating Browser, memory, Goal Hive, or Morphling as post-parity extras.

## Evidence Record

Each scenario result should record:

- scenario ID and date;
- runtime(s) used;
- model/provider when applicable;
- harness layer;
- command or manual steps;
- key event sequence;
- side effects and approval decisions;
- final outcome summary;
- gaps, accepted variance, and rollback notes.

The first implementation of the harness may store this evidence in devlog
entries and test output. Slice 9D defines the structured local comparison
report shape in [Parity Comparator Report](./parity-comparator-report.md).

## Slice Mapping

- Slice 9A freezes this manifest and RFC 7 split. No runtime changes.
- Slice 9B implements native mock and integration harness coverage.
- Slice 9C locks CLI/Supervisor event compatibility.
- Slice 9D adds managed-vs-native scenario comparison.
- Slice 9E records dogfood metrics and troubleshooting guidance.
- Slice 9F exposes opt-in beta with tested managed fallback.

New-user default switch remains Slice 10 and requires this manifest to pass at
the required gates.
