# GA upstream upgrade: 4086d5c -> d8d90ee

Date: 2026-08-03

## Why this upgrade happened now

JC asked what upstream had shipped since the baseline, then took the survey
straight to a full upgrade. No forcing incident this time — unlike the
2026-07-23 round, upstream `main` history is intact and `4086d5c` still
resolves. Locked target from `git ls-remote`:
`d8d90eef8c37cb1ea9aae078a3d099a7d7a759df` (2026-08-03 11:44 +0800),
tree `d457b6e8b02c7895504c888da5e7ee064fb43f1a`.

Delta: 20 commits over 11 days, 20 files, ~971 insertions / ~137 deletions.

## Delta shape

Roughly two thirds of the diff is upstream's own frontends and is inert on
Galley's path: `stapp.py` (+299, lazy history render, runtime stats, streaming
stabilization), a brand-new `frontends/hub.py` + `hub.html` WS peer hub,
`conductor.*`, `desktop/static/app.js`, `wechatapp.py`, `model_cmd.py`, plus
WeChat QR asset churn (7 images deleted, 1 replaced).

Engine core is `llmcore.py` (+78), `agentmain.py`, `ga.py`, `agent_loop.py`.
`pyproject.toml` zero diff, so dependencies and `scripts/bundle-python.sh`
needed no change.

The substantive upstream work in this range is **abort responsiveness and
streaming-error robustness**:

- `_stream_with_retry` now stores the live response on `sess.active_response`
  and returns early when `sess.should_stop()` is set; `agentmain.abort()`
  reaches into `llmclient.backend._sessions` to set that flag and close the
  response. Previously a user stop left the HTTP stream running to completion.
- `retry-after` is capped by a new `max_retry_after` session option
  (default 60s) — an oversized server `Retry-After` used to hang the session.
- Responses API `response.incomplete` / `response.failed` are handled as valid
  terminal events. That stream never emits `[DONE]`, which previously produced
  an empty-response retry storm; `reasoning_text` is now captured too.
- `_fix_messages` drops empty text blocks (HTTP 400 fix) and no longer inserts
  a `{"type":"text","text":"\n"}` separator when merging same-role messages.
- `ga.py`: `code_run` refuses `timeout > 600`, telling the model to background
  long work. `file_patch` error strings went from Chinese to English.
- `agent_loop.py`: the `proxy()` wrapper around the first dispatch chunk is
  gone; in verbose mode that chunk is concatenated onto the opening fence
  marker. Content-equivalent, but a stream chunk-boundary change — and the
  first change to this file since the `5257dec` baseline.

## Method note: zero-context apply is not a conflict test

The first-pass probe applied the stack to the new tree with
`git apply --unidiff-zero` and reported all 14 patches clean. The commit-chain
rebase then found a real conflict. Zero-context hunks are purely positional:
`git apply` happily places a hunk on a line upstream has rewritten, which is
exactly the silent mis-drop `docs/ga-baseline.md` warns about. Only the 3-way
merge in `rebase-managed-ga-patches.sh` detects genuine overlap. Do not treat a
clean `git apply` probe as a rebase preview.

## The one real conflict

`0007-managed-codex-backend.patch`, `llmcore.py`. Upstream's `retry-after` cap
rewrote the same `_stream_with_retry` `err =` line that the patch's codex 429
quota enrichment targets. Both kept, in order:

```python
if r.status_code == 429 and getattr(sess, 'codex_backend', False):
    body = _codex_enrich_quota_error(sess, headers, body)
err = f"!!!Error: HTTP {r.status_code}" + (f" (retry-after > {cap:.0f}s)" if ... ) + (f": {body}" if body else "")
```

The composition is correct because the enrichment mutates `body` and upstream's
fuller `err` format then consumes it. The other 13 patches replayed clean;
`llmcore.py` hunks shifted from the new `STATS`, `active_response`, and
Responses-API terminal-event handling, all absorbed positionally. Patch `0015`
kept its 8 binary hunks (the 2026-07-20 icon-PNG regression did not recur).

## Test-fixture drift, not a product bug

`test_managed_ga_llmcore.py` broke on upstream's new
`STATS['session'] = sess.name`: two `types.SimpleNamespace` session stubs had
no `name`. Real sessions always do — `BaseSession.__init__` sets `self.name`,
as does the multi-session wrapper. Fixed by adding `name=` to both fixtures
rather than guarding the upstream line, since the stub was simply incomplete.

## Open coupling break: untagged thinking deltas (default-on)

`_parse_claude_sse` now does `if thinking: yield thinking` — it emits Claude
extended-thinking content **into the output stream without tags**. Previously
`thinking_delta` was only accumulated into `current_block["thinking"]` and
never yielded, so it reached history but never the visible stream.

The reason this bites Galley is that **two unrelated things are both called
"thinking"**:

- The `<thinking>` tags Galley strips are a *prompted convention*. GA's system
  prompt (`llmcore.py:894`) instructs the model to wrap its reasoning in
  `<thinking>` tags, so it arrives as ordinary `text_delta` text that happens
  to carry markers. Every GA frontend and Galley regex it out.
- Anthropic's native extended thinking is a separate SSE channel
  (`thinking_delta`, distinct from `text_delta`). It is structurally
  distinguishable but carries no markers — and it is what upstream just started
  yielding.

So untagged reasoning now lands in the same character stream as the answer,
with nothing downstream can key on. Galley's path:
GA chunk → bridge → `TurnProgressEvent.delta` → GUI `inFlightContent` →
`<thinking>` strip. The strip misses, and reasoning renders as assistant text.
This breaks the "GA-raw, *with* tags" contract documented on
`TurnProgressEvent` in `runner/ipc.py`.

**This is default-on, not an edge case.** The first pass of this audit claimed
it was unreachable because Galley never sets `thinking_budget_tokens` — wrong:
the switch is `thinking_type`, set on the Rust side, not in `runner/`.
`core/src/commands/managed_model.rs` `managed_model_advanced_defaults` ships
`"thinking_type": "adaptive"` (and `"stream": true`) for every
Anthropic-protocol managed model, and GA's `_apply_claude_thinking`
(`llmcore.py:632`) sends any non-`enabled` value straight into the payload —
`adaptive` bypasses the `budget_tokens` guard entirely. So thinking is
requested on every managed Anthropic session, and the streaming parser is
`_parse_claude_sse`. Users would see raw reasoning dumped into the reply
bubble.

`omit_thinking` is not a mitigation — it only filters thinking out of session
*history* (`llmcore.py:806`), not the display stream. A user can set
`thinking_type: disabled` in advanced options (user values override the
defaults), but that is a workaround, not a fix.

Not fixed in this upgrade — recorded so it is not rediscovered from a bug
report, and so the shipping decision is explicit. The fix belongs on Galley's
side (tag or classify the delta at the bridge), not as a managed-runtime patch
that would have to be re-litigated on every rebase. **This should be resolved
before `d8d90ee` ships in a release.**

## Other things to watch

- `agentmain.all_outputs` accumulates every turn's input + outputs (capped at
  10000 entries, trimmed to 5000). It exists so a refreshed upstream UI can
  re-attach to a live task — dead weight for Galley, and real memory growth in
  long-lived per-session child processes.
- `abort()` dereferencing `self.llmclient.backend` is safe against patch
  `0001`'s `llmclient = None` initial state: `abort()` early-returns on
  `if not self.is_running`.
- `frontends/hub.py` is upstream growing its own multi-frontend orchestration
  (shared composer, busy-reject, abort, stapp adopting hub tasks as real
  bubbles). No code impact — WS/TCP is outside Rule 2 by construction — but it
  overlaps Galley's positioning and is worth tracking.

## Rule-1 audit

No new engine-core writes bypassing `GALLEY_GA_STATE_ROOT`. The new path
constants (`FILE_HOME`, `UPLOAD_DIR`, `hub.html`) all live in `hub.py` /
`conductor.py`, which Galley does not run. Upstream added no official
state-root or profile option, so patch `0001` stays. No config key renames;
`max_retry_after` is purely additive.

## Verification

```
scripts/rebase-managed-ga-patches.sh   old-chain replay matched checked-in payload
scripts/build-managed-ga.sh            14/14 applied, compile sweep OK
check-managed-ga-payload.mjs           OK
check-ga-baseline-drift.mjs            OK (d8d90eef)
pytest runner/tests -m 'not e2e'       189 passed (GA_PATH=/tmp/galley-ga-upgrade)
mypy runner                            no issues, 22 files
ruff check runner                      passed
cargo check --workspace                OK
cargo test --workspace                 365 passed
pnpm --dir gui typecheck / lint        clean
check-bundled-python-managed-ga.sh     OK (bundle is bridge-ready)
```

e2e was not run — it needs a real GA + LLM and spends model quota. The
compat-matrix run used `GA_PATH=/tmp/galley-ga-upgrade`, so the attach-mode
path was exercised against the new upstream.

## Not done

`d8d90ee` is audited but **not yet shipped** — `v0.4.1` ships `4086d5c`.
`docs/project-status.md` records that split. Desktop dogfood is JC's call at
release time; the abort-path change is the thing to feel, since a stop now
tears down the live HTTP stream instead of letting it drain.
