# Galley Native Open Decisions

> Status: pre-freeze decision sheet.
>
> Scope: decisions that should be settled before Slice 1 implementation. This
> document does not implement code, schema, or runtime behavior.

## Purpose

Slice 1 should only prove that Galley can carry a third runtime kind without
changing `managed` or `external` behavior. These decisions affect that first
slice's shape, so they should be reviewed before code starts.

Decision statuses:

- **Recommended**: current proposed direction.
- **Accepted**: ready to guide implementation.
- **Revisit**: do not implement until resolved.

## D1: Legacy `gaRuntimeKind` Projection

Status: Recommended.

Question: how should a native session appear in the existing
`schemaVersion: 1` fields?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. Mirror native | `runtimeKind = "galley_native"` and `gaRuntimeKind = "galley_native"` | Semantically ugly because `gaRuntimeKind` is GA-named |
| B. Keep GA-only | `runtimeKind = "galley_native"` and omit/null `gaRuntimeKind` for native | Higher v1 compatibility risk because the field is currently required |
| C. Schema v2 now | Rename/replace GA-shaped fields before native | Too much blast radius before Slice 1 |

Recommendation: **Option A for schema v1, with explicit deprecation debt**.

Why:

- `schemaVersion: 1` allows additive enum values but not removals/renames.
- Existing code and docs treat `gaRuntimeKind` as present on `SessionBrief`.
- Returning `null` or omitting it only for native would create a sharper client
  compatibility hazard than adding `galley_native`.
- `runtimeKind` remains the product-facing field; callers should prefer it.

Implementation notes:

- Add `galley_native` to the documented v1 enum set when Slice 1 lands.
- Add optional neutral fields only if implementation needs them, not as a v1
  rename workaround.
- Mark `gaRuntimeKind` as legacy compatibility projection in docs.
- Reserve the true cleanup for `schemaVersion: 2`.

User impact:

- Existing agents keep receiving a stable field.
- New agents can key on `runtimeKind` and ignore the GA-shaped legacy field.

## D2: Native Feature Gate

Status: Recommended.

Question: how is native enabled before opt-in beta?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. Environment flag | `GALLEY_NATIVE_EXPERIMENTAL=1` enables hidden native routes | Developer-only; not discoverable |
| B. Hidden pref | Internal DB preference toggled by CLI/debug command | More state to migrate and support |
| C. Visible Settings toggle | User-facing experimental runtime toggle | Too early; exposes unstable runtime |
| D. Compile feature | Build-time feature flag | Too rigid for dogfood binaries |

Recommendation: **Option A for Slice 1-3; add a hidden pref only when dogfood
needs persistence**.

Why:

- Slice 1 is about proving the router, not inviting users.
- Environment flags are easy to disable and do not affect first-run UX.
- Visible Settings belongs to Slice 9 opt-in beta, after parity evidence.

Implementation notes:

- Gate native session creation, runtime listing, and CLI runtime arguments
  consistently.
- Native must never become the default while the gate is off.
- Error messages should say native is experimental/unavailable, not "unknown
  runtime".

User impact:

- Ordinary users see no new runtime choice.
- Maintainers can dogfood without forking the product surface.

## D3: Mock-Model Provider Shape

Status: Recommended.

Question: should the mock model be a Core-internal test adapter or a persisted
Provider record?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. Core internal adapter | Mock responses live in tests/dev harness only | Not user-configurable |
| B. Fake Provider record | Mock appears in Provider/Model config | Pollutes product model |
| C. External test server | Mock model runs as local HTTP service | Extra moving part |

Recommendation: **Option A**.

Why:

- Mock model exists to make the loop deterministic, not to be a user runtime.
- It should not appear in onboarding, Settings, Provider lists, or persisted
  user model config.
- Tests can script exact tool calls, malformed responses, and recovery paths.

Implementation notes:

- Keep mock adapter behind test/dev-only module boundaries where practical.
- Use it for Slice 2, 4A, 5, 7, and parity harness tests.
- Do not let mock adapter shape leak into real provider abstractions.

User impact:

- No new setup concept.
- More deterministic native behavior before real users see it.

## D4: Native Memory Storage Shape

Status: Recommended.

Question: where should native memory and capability-pack state live?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. SQLite only | Store all memory/pack bodies in DB | Harder to inspect scripts/files; DB can bloat |
| B. Files only | Store memory as files under app data | Harder to query, diff, and rollback safely |
| C. Hybrid | SQLite metadata/evidence/index/change records + app-data resource files | More design work |

Recommendation: **Option C**.

Why:

- Memory needs identity, scope, evidence, diff, status, and rollback.
- Capability packs may include scripts and SOP bodies that are easier to handle
  as versioned resource files.
- Galley can expose `memory://` and `capability://` resources without making
  raw files the source of truth.

Implementation notes:

- SQLite owns metadata, indexes, evidence, change records, and activation.
- App-data resource files store larger SOP/script bodies with hashes and
  version references.
- Never use `managed-ga-state` as a native memory bridge.
- Never write external GA memory/SOP/skills.

User impact:

- Memory can be inspected and undone.
- Scripts remain file-like enough for review without becoming hidden mutable
  runtime code.

## D5: First Real Model Adapter

Status: Recommended.

Question: which real provider protocol should native support first?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. OpenAI-compatible first | Implement chat/tool-call compatible path first | Anthropic parity follows later |
| B. Anthropic-compatible first | Implement messages/tool-use path first | Smaller immediate coverage in current provider ecosystem |
| C. Both at once | Implement both before dogfood | Larger first adapter slice |

Recommendation: **Option A, while designing canonical messages to avoid
OpenAI lock-in**.

Why:

- Existing managed Provider/Model configuration already has broad
  OpenAI-compatible use.
- It is enough to prove one real native turn after the mock adapter.
- Anthropic-compatible support should follow, but not block Slice 3.

Implementation notes:

- Canonical `NativeMessage` / `ContentBlock` must remain provider-neutral.
- Tool-call parsing should keep Anthropic-style tool-use in mind.
- Adapter fixtures should include provider errors, max-token/incomplete, and
  structured tool-call responses.

User impact:

- First native dogfood can use the model setup Galley users already understand.
- Later provider parity does not require reworking the loop.

## D6: Runtime Event Ownership

Status: Recommended.

Question: should Slice 1 introduce a neutral runtime event model before native
emits real events?

Options:

| Option | Shape | Cost |
|---|---|---|
| A. Keep Python `IpcEvent` as the shared model | Native fakes or reuses Python-shaped events | Leaks bridge semantics into native |
| B. Add internal `RuntimeEvent` and adapters | Python runner maps into neutral events; native emits neutral events | More initial plumbing |
| C. Redesign public event stream now | Public schema changes immediately | Too much v1 risk |

Recommendation: **Option B**.

Why:

- Native should not fake GA path, GA commit, or Python process metadata.
- GUI/CLI can keep compatible event projections while Core gains a neutral
  internal model.
- This makes Slice 2-4 easier to test without coupling to Python bridge names.

Implementation notes:

- `IpcEvent` remains the Python bridge input type.
- Add a Core-owned internal event representation with neutral `RuntimeReady`.
- Public streams keep v1 compatibility with optional additive fields.
- Do not remove Python-shaped public fields until a schema bump.

User impact:

- Existing session watching and GUI flows stay stable.
- Native can show truthful runtime state instead of placeholder GA metadata.

## Freeze Checklist

Before Slice 1 code starts:

- D1-D6 are accepted or explicitly revised.
- [Implementation Slices](./implementation-slices.md) still matches accepted
  decisions.
- [RFC 1](./rfc-1-runtime-boundary.md) and [RFC 7](./rfc-7-parity-harness-default-switch.md)
  reflect any decision changes that affect Slice 1.
- `managed` and `external` no-regression test expectations are listed in the
  Slice 1 implementation plan.
- Native is still hidden and cannot become the default.
