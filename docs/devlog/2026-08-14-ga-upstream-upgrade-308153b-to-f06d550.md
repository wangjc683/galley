# GA upstream upgrade `308153b` -> `f06d550`

Date: 2026-08-14
Range: `308153b1c91401a892401dd896e548e587506cc9` ->
`f06d5503808ba9d164fb583e4c500d5ce01efd4c` (7 commits, 11 files,
~138 insertions / ~88 deletions)

The smallest range since the baseline was introduced, and the first one
where the interesting findings were **not** in the engine core.

## Shape

Engine core moved in two files only — `ga.py` (13 lines) and `llmcore.py`
(11) — and the three files whose diffs usually cost the most audit time
(`agent_loop.py`, `agentmain.py`, `pyproject.toml`) had **zero diff**. So
no bridge protocol break, no dependency delta, no `bundle-python.sh`
edit. The remaining ~80% is upstream's own frontends (the P2P stack,
`worldline`, `continue_cmd`, `conductor`) plus the two
`global_mem_insight` templates.

The patch-stack rebase was where the work actually was.

## The one coupling worth remembering: `hook(locals())`

Upstream rewrote `turn_end_callback`'s summary extraction to skip empty
recaps:

```python
raw = (rsumm.group(1) if rsumm else _c).strip()
if raw:
    summary = smart_format(raw.replace('\n', ''), max_str_len=80)
    self.history_info.append('[Agent] ' + summary)
```

`summary` is now bound **inside** the `if`. That matters because
`ga.py:599` dispatches turn-end hooks as `hook(locals())` — Galley's
`workbench_bridge._on_turn_end` is reading the callback's local variable
table, not a designed payload. When a turn's reply carries no text
outside code fences / thinking — routine on native tool-use backends,
where the model goes straight to a `tool_use` block — the name simply
never exists, and `ctx.get("summary")` returns `None` where it used to
return a synthesized `"code_run, args: {...}"` string.

Galley absorbs this without a code change, and the reason is a guard
someone wrote for a different occasion. `bump_session_after_turn_db`
skips the `summary` column entirely on an empty value:

> Bridge sometimes emits turn_end with empty summary (no recap generated
> this round); we keep the previous summary so the sidebar row doesn't
> blank out mid-conversation.

`session.summary` is the only consumer, so the net effect is a *better*
sidebar row: the last real recap survives instead of being overwritten by
machine-y tool-args text. **Re-verify if that Rust guard is ever
removed** — it is load-bearing for an upstream behavior it was not
written against.

Also checked and left alone: `_clean_turn_summary`'s docstring says GA
"falls back to the raw reply body middle-truncated by `smart_format`",
which is still exactly true. What disappeared is a *second*-level
fallback the docstring never claimed.

## `</summary>` no longer means "truncated"

```python
- if ... or content.endswith('</summary>'):
+ if ... or (content.endswith('</summary>') and len(content) < 100):
```

Upstream's own system prompt asks the model to emit `<summary>`, so a
final answer that obediently *ended* with its summary block was being
classified as a truncated stream and force-regenerated. This is
Galley-positive and observable in managed mode: fewer spurious
regenerations on final answers. It also invalidates a line this repo had
been carrying forward in `ga-baseline.md` since the `5257dec` era, now
corrected.

## Overload retry reaches the OpenAI paths

The Claude-SSE overload heuristic (`concurrency|retry later|overloaded|
rate.?limit` → raise `requests.ConnectionError`) was extracted into
`_raise_if_retryable_overload()` and wired into all three OpenAI paths.
Overload bodies that arrive as HTTP 200 now route into
`_stream_with_retry`'s network backoff on OpenAI-protocol models too,
instead of surfacing as an application-layer `!!!Error:` string in the
reply.

Checked against `0007` (managed codex backend): unaffected. `0007` forces
streaming, so `_parse_openai_json` is not its path, and its 429 quota
enrichment lives on the HTTP-status side, not the SSE-body side.

## Upstream converged on `0015`, independently

`e519734 fix(tmwd): show real WS status on badge, click-through + lower
opacity` made the in-page `ljq_driver` badge `pointer-events:none`,
dropped its opacity 0.5 → 0.2, and gave it a real 3-state
connected/connecting/disconnected broadcast.

Those are two of the three defects Galley's `0015` cited on 2026-07-20
when it deleted the badge outright ("covered page content, swallowed
clicks, and showed 'connected' regardless of real bridge state").

Origin discipline, per the SOP — direction verified with `git log -S`
before writing this down rather than after:

- `e519734` — Liang Jiaqing, upstream, 2026-08-13.
- Galley `0015` — `9abe74dd`, 2026-07-20.
- No shared code, and Galley does not upstream.

So: **convergence, not adoption in either direction.** Upstream reached
the same complaint about its own badge ~3.5 weeks later, on its own.

`0015` stays, and this is **not** a decision that needed re-opening —
recorded here because the first pass of this upgrade wrongly framed it as
one, and the framing came from a defect in the record.

`0015`'s manifest entry led with its three complaints about the upstream
badge. Upstream fixed two of them, which reads like movement toward the
patch's removal condition ("upstream drops its in-page indicator and
ships an equivalent truthful toolbar status"). It isn't. Those three
complaints were the **evidence**; the decision was the positive half of
the same sentence — *bridge status belongs on the toolbar, not injected
into the user's pages*. That stance is untouched by upstream making its
injected node quieter. A 0.2-opacity click-through badge is still a DOM
node pushed into every top-level page the user visits, and still a second
indicator for a state Galley's toolbar badge already shows truthfully.
`0015` also carries branding, the icon set, and the popup
cookie-auto-copy fix, none of which upstream went near.

JC caught the bad framing immediately ("我们之前已经改到页内消失了啊？").
The generalizable error: **a patch's cited evidence is not its
justification.** When upstream resolves the evidence, check whether the
decision rested on it before treating the patch as loose. The manifest
entry has been rewritten to lead with the decision, and its removal
condition now names all three concerns explicitly and says upstream
polishing the badge is not a trigger.

What *is* real here is a maintenance cost, not a product question:
upstream is actively investing in the exact block `0015` deletes, so the
`content.js` deletion will keep colliding on every upgrade. Priced in;
the patch's rebase risk was raised to Medium to say so.

## Rebase: two real conflicts, one of them forced

Commit-chain rebase via `scripts/rebase-managed-ga-patches.sh`. The
old-chain replay matched the checked-in payload byte-for-byte first, so
there was no pre-existing drift to untangle. Both conflicts came from
`e519734` alone, landing on the exact lines `0006` and `0015` own.

`0006` / `background.js`, four sites. Three are pure additive collisions
(upstream's `status` command, its `setStatus()` definition, and
`setStatus('connected')` each landed on a `0006` insertion point) — both
sides kept. The fourth is semantic and had only one legal answer:
upstream put `setStatus('disconnected')` in the `else` branch of an
`isServerAlive()` gate, and **`0006` deletes `isServerAlive()`** (its
HTTP poke at the WS port is what stalled recovery on Windows). Taking
upstream's side would have called a function that does not exist in the
patched tree — a `ReferenceError` at runtime that no Python compile sweep
would ever catch. Resolved to `0006`'s unconditional `connectWS()`, with
a comment recording why the gate cannot come back.

`0015` / `content.js`: upstream rewrote the exact block `0015` deletes.
Resolved to the deletion. `0015` / `background.js`: `setStatus('connected')`
vs `updateActionIcon(true)`, both kept.

Consequence, accepted deliberately: upstream's `status` / `setStatus`
machinery survives in the managed payload as **dead code** — `0015`
removes its only consumer, and `disconnected` is now unreachable.
Deleting it would grow the patch for no behavioral gain, against the
"keep patches minimal" rule.

`0016` / `0017`'s zero-context `_parse_claude_sse` hunks drifted purely
positionally past upstream's new `_raise_if_retryable_overload` helper
and were carried by the rebase without incident. That is the whole
argument for the commit-chain script over hand-shifting hunks: those two
would have mis-dropped silently, and JS conflicts like `0006`'s would
have stayed invisible until runtime.

## Verification

| Gate | Result |
|---|---|
| Old-chain replay vs checked-in payload | byte-identical |
| `build-managed-ga.sh` compile sweep | OK (all 18 patches) |
| `check-managed-ga-payload.mjs` | OK |
| `node --check` on both extension JS files | OK (the Python sweep cannot see these) |
| `pytest runner/tests -m 'not e2e'` with `GA_PATH` at new SHA | 234 passed |
| `check-bundled-python-managed-ga.sh` | OK (bridge-ready) |
| `check-ga-baseline-drift.mjs` | OK (`f06d5503`) |
| `cargo test --workspace` / `pnpm typecheck` / `lint` | pass |

`bundle-python.sh` was **not** re-run: `pyproject.toml` had zero diff, so
`GA_DEPS` is unchanged, and the smoke was run against the existing bundle
instead — which is the check that actually matters here (does the new
payload import under bundled Python).

Not run: step 8 desktop dogfood in both runtime modes, and the opt-in e2e
suite. Left for JC.
