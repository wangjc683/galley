# 2026-05-27 - GA upstream upgrade 1a8abc4 -> 1c9f141

**Date / Status**: 2026-05-27 / rehearsal implemented on upgrade branch
**Related**: [GA baseline](../ga-baseline.md) · [managed GA runtime](../managed-ga-runtime.md)

## Context

Galley used to have only attach mode, so a GenericAgent baseline upgrade mostly
meant auditing whether a user-owned GA checkout still worked with Galley's
bridge. Managed GA changes that risk model: Galley now ships a patched
GenericAgent payload, so upstream upgrades must also prove that the managed
patch stack can be replayed and packaged without user state or local checkout
artifacts.

The official upstream target was locked with `git ls-remote`:

```text
1c9f141ecd52d1e6900ca1405ebbd75a382bee5f refs/heads/main
```

That commit is `chore: update WeChat group 19 QR code image (#492)`.

## Decisions

1. **Move the audited baseline and managed manifest to `1c9f141`**
   The delta from `1a8abc4` contains 18 commits. No external bridge protocol
   surface broke.

2. **Treat clean-source managed rebase as mandatory**
   The maintainer's local `~/Documents/GenericAgent` checkout was at the right
   commit but had untracked bot launch scripts. `scripts/build-managed-ga.sh`
   now refuses a dirty source checkout and tells maintainers to use a clean
   temporary clone.

3. **Map Galley's `connect_timeout` to GA's new `timeout` key**
   Upstream `llmcore.BaseSession` now reads `timeout` for connection timeout.
   Galley keeps `connect_timeout` in managed model records and emits `timeout`
   during managed config injection so existing model settings do not silently
   lose their connection timeout.

4. **Bundle `aiohttp` and verify the vendored managed payload**
   GenericAgent's core `pyproject.toml` already listed `aiohttp>=3.9`, but
   Galley's bundled Python list omitted it. `scripts/bundle-python.sh` now pins
   `aiohttp==3.13.5` and verifies by importing `managed-ga/code`, not the local
   external GA checkout.

## Audit

| Surface | Change | Verdict |
|---|---|---|
| `agent_loop.py` | No relevant diff; `BaseHandler.dispatch(..., tool_num=1)` and hook trigger shape unchanged | Safe |
| `ga.py` | Windows shell execution prefers `pwsh` and forces UTF-8; `_turn_end_hooks` iteration wraps `values()` with `list()` | Safe; hook change is favorable for Galley |
| `llmcore.py` | `reload_mykeys()` catches load errors; connection timeout config key changed from `connect_timeout` to `timeout` | Managed adapter added |
| `pyproject.toml` | Optional UI deps add `prompt_toolkit`, `rich`, `pillow`; core deps unchanged from previous upstream baseline | No optional frontend bundle change |
| Managed patch stack | `0001-managed-state-root.patch` applied cleanly to `agentmain.py`, `ga.py`, `llmcore.py`, and `frontends/continue_cmd.py` | Safe after semantic state-path scan |

## Rehearsal Findings

- A correct commit is not enough for managed GA. A dirty source checkout can
  include untracked local files unless the build script blocks it.
- Payload gates catch generated artifacts well: an import smoke created
  `managed-ga/code/__pycache__`, and `check-managed-ga-payload.mjs` failed as
  intended.
- Bundle verification must import Galley's vendored managed payload. Importing
  `~/Documents/GenericAgent` can hide a missing packaged dependency.
- The old workflow language treated baseline and managed runtime as separate
  release preflight items. The real process is one upstream upgrade gate with
  two outputs: external compatibility and managed payload rebase.

## Verification

```text
GA_PATH=/private/tmp/galley-ga-upgrade-1c9f141.2PkyF1/GenericAgent \
  .venv/bin/python -m pytest runner/tests/ -m 'not e2e'
=> 95 passed, 6 deselected

node scripts/check-managed-ga-payload.mjs
=> [managed-ga-payload] OK

PYTHONDONTWRITEBYTECODE=1 GALLEY_GA_STATE_ROOT=/private/tmp/galley-managed-import-smoke \
  python3 -c "import sys; sys.path.insert(0, 'managed-ga/code'); import agentmain, llmcore"
=> managed import OK

./scripts/bundle-python.sh mac-x64
=> managed GA import OK (bundle is bridge-ready)

GA_PATH=~/Documents/GenericAgent \
  BRIDGE_PYTHON=python3 \
  E2E_LLM_NAME=glm-5.1 \
  .venv/bin/python -m pytest runner/tests/ -m e2e -vv
=> 6 passed, 95 deselected
```

The first default-model e2e run passed 5/6 and exposed that relying on the
user's current GA default model is noisy. The e2e suite now accepts
`E2E_LLM_NAME` so maintainers can pin a known quota-safe model for release
validation without changing `mykey.py`.

## Next

- Dogfood one real external GA session and one managed GA session before
  release, including tool dispatch and restart / restore behavior.
- Consider adding an automated manifest alignment check so
  `docs/ga-baseline.md` and `managed-ga/manifest.json` cannot drift silently.
