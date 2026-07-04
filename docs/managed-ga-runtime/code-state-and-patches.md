# Managed Runtime: Code, State, Patch Discipline, And Backup

> Part of the [managed GA runtime reference](./README.md).


The managed runtime follows one central rule:

```text
Code is replaceable. State is user-owned.
```

Managed GA code is part of Galley's shipped product runtime. It may be replaced
when Galley updates to a newer upstream GenericAgent baseline plus the Galley
managed patch stack.

Managed GA state is user-owned Galley state. Runtime upgrades must not
overwrite it.

Normal managed GA upgrades are code-only. They should feel like a user-owned GA
checkout receiving `git pull`: the kernel code moves forward, while the user's
memory, SOP, skills, temp state, model responses, and generated model config
remain in place.

State migration is exceptional. It is only required when upstream GenericAgent
changes the format or location contract of user state. In that case, treat it as
a high-risk migration: back up first, document the upstream reason, and dogfood
with real managed-runtime state.

Compatibility note: migrations `021`-`024` are retained byte-for-byte from the
abandoned Galley Native experiment so dogfood databases that already applied
them can still pass SQLx migration validation after returning to main. Migration
`025` restores persisted `galley_native` runtime values back to `managed`.
Keeping these migration records does not re-enable the Rust native runtime on
main; it only protects local user state from a development downgrade trap.

Suggested layout:

```text
App Resources/
  managed-ga/
    manifest.json               # pinned upstream baseline + patch stack id
    code/                       # read-only managed GA code payload
    state-seed/
      memory/                   # upstream tracked GA memory/SOP defaults
    patches/
      manifest.md

Application Support/app.galley/
  galley.db
  managed-ga-state/
    memory/                   # the ONLY dir GA reads SOPs from
    sop/                      # vestigial: created but GA never reads it
    skills/                   # vestigial: created but GA never reads it
    temp/
    model_responses/
  managed-model-config/
    generated-mykey.py          # or model-config.json
```

> **SOP home is `memory/`, not `sop/` or `skills/`.** GenericAgent discovers and
> reads SOPs via `file_read ../memory/*.md` and the L1 index
> `global_mem_insight.txt`; there is no loader for a sibling `sop/` or `skills/`
> directory. A separate Galley-owned SOP directory was considered and rejected
> (see devlog 2026-06-03) because it changes upstream GenericAgent semantics and
> creates a second source of truth. New tooling that installs SOPs must write
> into `managed-ga-state/memory/`. The empty `sop/` and `skills/` entries above
> are vestigial layout shells and may be removed; do not treat them as a target
> for SOP content.

Initial setup may seed default state only when the target file or directory is
missing. Existing state must not be overwritten:

```text
if missing: create default
if exists: leave it alone
```

The default GA memory/SOP seed lives under app resources, but runtime reads and
writes still go through `managed-ga-state/memory/`. The seed is copied
missing-only so existing `global_mem.txt`, `global_mem_insight.txt`, custom SOPs,
skills, and edited memory files survive normal Galley updates.

## Patch Discipline

Managed GA can be patched, but Galley must not become a divergent GA fork.

Recommended source strategy:

```text
managed-ga/manifest.json        # pinned upstream baseline + patch stack id
managed-ga/code/                # generated code-only payload
managed-ga/patches/
  0001-managed-state-root.patch
  0006-managed-browser-control-recovery.patch
  ...                          # see patches/manifest.md for the full stack
managed-ga/patches/manifest.md
scripts/build-managed-ga.sh
```

Rules:

- Keep every patch small and product-scoped.
- Prefer upstream public APIs or config first.
- Prefer environment-variable or file-path extension seams before code edits.
- Document every patch with reason, touched upstream files, rebase risk, and
  removal condition.
- Patches must be replayable on top of a newer upstream baseline.
- If upstream provides the same capability, delete the Galley patch.
- Changes touching agent loop, tool protocol, memory semantics, or backend
  history shape are high risk and require a baseline audit.

### How To Add A Patch

Never edit `managed-ga/code/` directly. It is a generated payload: a direct
edit is silently discarded on the next baseline rebuild, and it bypasses the
patch ledger that makes the stack auditable and replayable. To change managed
runtime behavior:

1. Author the change as the next numbered **zero-context** unified diff in
   `managed-ga/patches/` (for example `0014-<slug>.patch`).
2. Record it in **both** ledgers: append the filename to
   `managed-ga/manifest.json` (`patchStack.patches`), and add a row to
   [`managed-ga/patches/manifest.md`](../../managed-ga/patches/manifest.md) with
   reason, touched upstream files, rebase risk, and removal condition.
3. Verify the stack replays: `scripts/build-managed-ga.sh` regenerates
   `code/` from the pinned upstream baseline and applies every patch in
   manifest order via `git apply --unidiff-zero`.
4. Mind ordering dependencies between patches touching the same upstream
   file (for example, the fsapp patches rebase `0009` first); record them in
   the manifest row's rebase-risk column.

`managed-ga/patches/manifest.md` is the authoritative ledger for the current
stack, including the last verified replay date.

## Backup And Device Migration

Managed GA memory, SOP, skills, temp state, and model response state belong to
Galley-managed state and should be included in Galley backup / migration.

External GA memory, SOP, skills, venv, and model config belong to the user's
external GA checkout and are never included or modified by Galley unless the
user explicitly backs up that checkout outside Galley.

Ordinary Galley backup should not include API keys. On a new machine, restored
managed sessions and memory can appear, but the user should re-enter model
credentials.

Future encrypted export can include API keys behind an explicit migration
password, but that is out of scope for the first managed-runtime version.
