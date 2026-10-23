# 2026-06-02 - GA upstream upgrade 1c9f141 -> 5f46b438

**Date / Status**: 2026-06-02 / implemented on upgrade branch
**Related**: [GA baseline](../ga-baseline.md) · [managed GA runtime](../managed-ga-runtime.md)

## Context

JC asked to move both Galley's built-in GenericAgent runtime and external-GA
compatibility audit to the official latest GenericAgent commit. The official
target was locked with `git ls-remote`:

```text
5f46b43816d6298f5e1d34c7076ea31f875b7810 refs/heads/main
```

That commit is `Merge pull request #550 from desmonna/fix/plugin-hooks-init`,
committed at `2026-06-02T10:10:20+08:00`.

## Decisions

1. **Move the audited baseline and managed manifest to `5f46b438`**
   The delta from `1c9f141` contains 80 commits. The external bridge contract
   stayed intact: `agent_loop.py` did not change, `BaseHandler.dispatch` keeps
   the same generator protocol, and `_turn_end_hooks` remains available.

2. **Keep the upgrade non-invasive for external GA**
   JC's local `~/Documents/GenericAgent` checkout already points
   at `5f46b438`, but it has untracked bot launch scripts. Galley did not modify
   that checkout and did not build managed GA from it. A clean temporary clone
   was used for the managed payload.

3. **Refresh the managed state-root patch**
   Upstream added two new state writes that matter only for managed mode:
   long prompts are written to `temp/user_prompt_*.md`, and `/continue` stores a
   round-count cache under `~/.genericagent`. Both were routed under
   `GALLEY_GA_STATE_ROOT` so managed runtime state stays in Galley app data.

4. **Regenerate the asset-path patch against the new upstream context**
   The old `0003-normalize-asset-path-joins.patch` depended on the old
   `agentmain.py` / `ga.py` context and no longer applied mechanically. It was
   regenerated after `0001` and `0002` so the patch stack remains replayable.

5. **Normalize incidental upstream trailing spaces during managed build**
   Upstream `agentmain.py` and `llmcore.py` contained two trailing spaces in the
   new delta. Galley keeps `git diff --check` as a release gate, so the managed
   build script now strips trailing spaces from those two generated payload
   files after replaying the patch stack. This keeps the checked-in payload
   clean without baking whitespace-only removals into a patch file that would
   fail the same gate.

## Audit

| Surface | Change | Verdict |
|---|---|---|
| `agent_loop.py` | No diff | Safe |
| `agentmain.py` | Task / reflect mode now force non-stream; long prompts are externalized to temp files; task timeouts increased | Bridge-safe; managed temp path patched |
| `ga.py` | Folded earlier-context window reduced from 100 to 70 lines | Safe |
| `llmcore.py` | Cloudflare 520-527 retry statuses; `BaseSession.ask()` always returns generator; NativeClaude headers / betas / fake-CC system injection changed; `MixinSession` broadcasts `stream` and `read_timeout` | Safe for Galley's generator-consuming bridge; no managed config schema change |
| `frontends/continue_cmd.py` | Added bounded preview/search and round-count cache | Managed log/cache paths patched |
| `plugins/__init__.py` | New package marker | Safe |
| `pyproject.toml` | No diff | No bundle dependency change |
| Managed patch stack | `0001` and `0003` required regeneration; `0002` and `0004` still replayed cleanly; build script normalizes two incidental upstream trailing spaces | Safe after clean-source replay |

## Verification

```text
node scripts/check-managed-ga-payload.mjs
=> [managed-ga-payload] OK

.venv/bin/python -m pytest runner/tests/ -m 'not e2e'
=> 102 passed, 6 deselected

./scripts/bundle-python.sh mac-x64
=> managed GA import OK (bundle is bridge-ready)

PYTHONDONTWRITEBYTECODE=1 GALLEY_GA_STATE_ROOT=/private/tmp/galley-managed-import-smoke-current \
  GALLEY_VERIFY_GA_PATH=~/Documents/genericagent-webui/managed-ga/code \
  core/python-bundle/python/bin/python3 -c "import os, sys; sys.path.insert(0, os.environ['GALLEY_VERIFY_GA_PATH']); import agentmain, llmcore, qrcode, dotenv; from Crypto.Cipher import AES"
=> managed GA import OK (current payload + bundled python)

pnpm --dir gui typecheck
=> passed

pnpm --dir gui lint
=> passed

git diff --check
=> passed
```

```text
GA_PATH=~/Documents/GenericAgent \
  BRIDGE_PYTHON=python3 \
  E2E_LLM_NAME=glm-5.1 \
  .venv/bin/python -m pytest runner/tests/ -m e2e -vv
=> 6 passed, 102 deselected

pnpm --dir gui tauri dev
=> JC dogfood managed GA real conversation in Dev mode: passed
```

## Next

- Optional release preflight: dogfood one real external GA session before
  release if the release contains more external-bridge changes.
