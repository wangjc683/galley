# Galley Native RFC 7: Parity Harness And Default Switch

> Status: accepted decision document; Slice 9A parity contract checkpoint landed
> on 2026-06-17.
>
> Scope: managed-vs-native parity testing, event contracts, dogfood metrics,
> rollout gates, default switch, rollback, and managed retirement. This RFC does
> not implement tests or runtime behavior. The scenario source of truth is the
> [Parity Scenario Manifest](./parity-scenario-manifest.md).

## Decision

`galley_native` should become the default built-in runtime only after it passes
a parity harness and dogfood gates.

Parity does not mean identical model text. It means native can complete the
same classes of work with the same or better product behavior:

- tool use;
- approvals;
- memory;
- browser control;
- session continuity;
- Goal Hive;
- Morphling;
- error recovery;
- user-visible events.

Managed GA remains the fallback until native proves replacement quality.

## Why This Matters For Users

Switching the default runtime is not a refactor milestone. It changes the core
experience of every new built-in user.

Users should get:

- fewer setup failures;
- no loss of GA's useful behaviors;
- clearer progress and recovery;
- safer memory and self-evolution;
- a fallback if native has a gap.

The test harness is what prevents "Rust rewrite" from becoming a capability
regression.

## Parity Definition

Native parity is measured at the product/semantic layer.

Compare:

- final outcome class;
- required tool sequence class;
- event timeline shape;
- approval decisions;
- memory write policy;
- recovery behavior;
- user-facing messages;
- persisted state.

Do not compare:

- exact assistant wording;
- exact model token counts;
- internal Python/Rust call stack;
- GA file names;
- provider-specific request shape.

## Harness Layers

### Unit Tests

Native-only deterministic tests:

- canonical message/content blocks;
- model adapter normalization;
- structured tool-call parsing;
- text fallback parser;
- `no_tool` classification;
- turn summary fallback;
- approval policy;
- resource path handling;
- file/code tool policy;
- native memory write classification;
- capability-pack manifest validation.

### Mock-Model Loop Tests

Use scripted model responses to test the whole loop without model
nondeterminism:

- final answer with no tool;
- tool call -> result -> final;
- malformed tool call -> correction;
- blank response -> retry;
- max-token response -> continuation;
- ask-user suspend/resume;
- memory update candidate.

### Integration Tests

Run native with real Core persistence and fake or safe tool executors:

- session new/send/watch;
- approval pending/allow/deny;
- file patch in temp workspace;
- code run in temp workspace;
- resource reads from `memory://` and `capability://`;
- workspace missing recovery;
- copy-and-continue;
- Goal task-board loop with mock workers.

### Managed-Vs-Native Scenario Tests

Run equivalent tasks through managed GA and native, then compare semantic
outcomes.

These tests should tolerate model variance and focus on capability parity.

## Required Scenario Set

V1 default switch requires the scenarios in the
[Parity Scenario Manifest](./parity-scenario-manifest.md).

The manifest assigns each scenario:

- a stable ID;
- harness layer;
- beta/default/support gate class;
- pass signal;
- allowed variance.

The required areas are basic answer, model adapters, `code_run`, file edit,
large code no-tool recovery, approval, `ask_user`, browser, memory read/write,
capability pack resources, workspace, continue, copy continue, CLI/Supervisor,
Goal Hive, Morphling, failure recovery, and managed fallback.

Some scenarios can be mock-model tests; some need dogfood with real models.

## Event Contract

Native should preserve the useful event rhythm:

```text
runtime_ready
turn_start
turn_progress
tool_pending
approval_pending
approval_resolved
tool_start
tool_progress
tool_end
ask_user
turn_end
run_complete
runtime_error
```

Harness should assert event order and required fields, not exact text.

Public stream compatibility must be tested for CLI/Supervisor users. If native
adds optional fields, old v1 consumers should continue working.

## Metrics

Dogfood should track:

- first-run setup completion rate;
- time to first useful response;
- runtime start failure rate;
- tool success/failure rates by tool;
- approval false positives/false negatives;
- browser readiness and recovery success;
- session restore success;
- memory update undo rate;
- native-vs-managed fallback rate;
- Goal completion and useful-result rate;
- crash/recovery incidents.

Metrics can be local/devlog-driven at first. Do not add remote telemetry without
a separate product/privacy decision.

## Default Switch Phases

### Phase A: Hidden Skeleton

Native exists behind an experimental flag. Only mock tests pass. No user-facing
default changes.

### Phase B: Developer Dogfood

Native can run basic chat and tools. Maintainers manually opt in and compare
against managed.

### Phase C: Opt-In Beta

Settings exposes native as experimental for built-in users. Managed remains
default. Native sessions can be copied from managed, not auto-migrated.

### Phase D: New-User Default

New built-in users default to native. Existing managed users keep their runtime
until they switch or copy sessions.

### Phase E: Managed Fallback Window

Managed stays installed and usable for fallback. Bugs can route users back to
managed without data loss.

### Phase F: Managed Retirement

Managed stops being the built-in fallback only after native covers parity,
dogfood, migration, and support requirements. External GA remains advanced
compatibility.

## Slice 9 Implementation Split

Slice 9 is split into smaller implementation slices:

| Slice | Purpose |
|---|---|
| 9A | Freeze parity contract and scenario manifest |
| 9B | Implement native mock/integration harness coverage |
| 9C | Prove CLI/Supervisor schema and event compatibility |
| 9D | Add managed-vs-native semantic comparator |
| 9E | Record dogfood evidence and troubleshooting |
| 9F | Expose opt-in beta with tested managed fallback |

The visible Settings opt-in belongs to 9F, not the beginning of Slice 9.
The Slice 9D comparator report contract lives in
[Parity Comparator Report](./parity-comparator-report.md).

## Default Switch Gates

Do not switch new users to native until:

- all unit/mock/integration gates pass;
- required scenarios pass or have explicit accepted gaps;
- Browser Control parity is usable;
- memory writes are inspectable and reversible;
- Goal Hive has real dogfood evidence;
- session restore/copy behavior works after app restart;
- CLI/Supervisor surfaces handle `galley_native`;
- managed fallback path is tested;
- docs and troubleshooting cover native-specific errors.

The default switch should be a release decision, not an incidental code merge.

## Rollback Policy

Runtime default must be reversible.

Rollback should:

- set built-in default back to managed;
- keep native sessions readable;
- allow copying native history to managed where feasible;
- leave native memory/capability state intact but inactive if needed;
- not delete user data;
- not mutate external GA.

If a native session cannot be continued in managed, the UI should explain that
it can still be read and copied manually.

## Managed Retirement Criteria

Managed can be retired from the default fallback role only when:

- native has replaced normal built-in workflows for a full dogfood window;
- managed fallback usage is low and understood;
- native supports model/provider setup at least as well as managed;
- memory/capability migration is intentional and stable;
- release notes give users a clear recovery path;
- external GA remains available for power users.

Removing managed code entirely is a separate future decision.

## Acceptance Checks Before Code

Before implementation, the design should answer:

- What exact scenario list gates native default?
- Which tests are mock-model and which require real LLM dogfood?
- How are managed/native outcomes compared?
- What public event fields are required?
- What metrics are collected locally?
- What is the native opt-in UI?
- How does rollback work per user and per session?
- What support path exists for managed users who do not migrate?

## Rejected Alternatives

### Switch Default When Core Compiles

Rejected because compile success says nothing about agent capability or product
quality.

### Require Exact Output Matching

Rejected because LLM output is nondeterministic. Parity should compare
semantics, safety, and state.

### Remove Managed As Soon As Native Exists

Rejected because managed is the working built-in runtime and the fallback during
native dogfood.

### Treat Browser, Memory, Or Goal As Post-Parity

Rejected because those are part of what makes GA valuable inside Galley. Native
without them is not replacement quality.
