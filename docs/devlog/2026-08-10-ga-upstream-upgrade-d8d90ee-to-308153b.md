# GA upstream upgrade: d8d90ee -> 308153b

Date: 2026-08-10

## Why this upgrade happened now

JC asked what upstream had shipped lately, having heard the hub feature got a
big boost. The survey confirmed it — and then turned into a full upgrade, the
same path as the 2026-08-03 round. No forcing incident: upstream `main` history
is intact and `d8d90ee` still resolves. Locked target from `git ls-remote`:
`308153b1c91401a892401dd896e548e587506cc9` (2026-08-10 14:02 +0800), tree
`6533522b7858869ef93590521466cf3ffdf4aeb7`.

Delta: 15 commits over 7 days, 20 files, ~1661 insertions / ~305 deletions.

## Delta shape

The insertion count is the most misleading number in this range. **~90% of the
diff is one new subsystem Galley never touches**: `frontends/p2p_ws_client.py`
alone is +1045, and with `hub_p2p.py` (+103), `hub.py` (+103), `hub.html`,
`stapp.py` (297), `desktop_pet_v2.pyw`, the community desktop app under
`frontends/desktop/**`, and the TUI trio, the frontend share is essentially the
whole upgrade.

Engine core is four files and 49 lines total: `llmcore.py` (28), `ga.py` (12),
`agentmain.py` (+7), `assets/tools_schema.json` (2). `agent_loop.py` had zero
diff. `pyproject.toml` had zero diff, so dependencies and
`scripts/bundle-python.sh` needed no change.

Triage paid off here: the must-read set (fixed contract files ∪ every file the
patch stack touches) is 26 files, and only **three** of them appear in this
delta. That made the read cheap and the prediction sharp.

## What upstream actually changed in the engine

- **Rate-limit errors reclassified as network errors.** `_parse_claude_sse`'s
  `error` branch now raises `requests.ConnectionError` when the SSE error
  message matches `concurrency|retry later|overloaded|rate.?limit`, so it lands
  in `_stream_with_retry`'s retry loop instead of surfacing as an
  application-layer `!!!Error:` string that `ga.py` would then have to handle.
- **Retry backoff slowed.** `_delay`'s base factor `1.5 → 3.0`, and
  `MixinSession._base_delay` default `1.5 → 3.0`.
- **Context defaults raised.** `default_context_win` `30000 → 35000`,
  `default_cut_msg_interval` `5 → 7` (deepseek `70000 → 80000`), plus the
  matching `cut_msg_interval` fallback in `trim_messages_history`. Trimming and
  tag compression both start later. Not a contract change, but long-session
  behavior is observably different — flagged for dogfood.
- **`_record_usage` null coercion.** An `_i()` helper turns `None` into `0`
  across all three API modes. See the origin note below.
- **`ga.py` prompt-tag renames.** `[System]` → `[ERROR]` on the three
  `_retry_or_exit` strings, `[SYSTEM]` → `[TIPS]` on the summary reminder,
  turn-13 / turn-31 checkpoint nudges → `[DANGER]`. Verified by grep that
  Galley couples to none of these strings.
- **`agentmain.py` gained `hub.connect()`** in the `--reflect` branch.
  Structurally unreachable from Galley — see below.

## Origin discipline: `_i()` does not absorb patch `0017`

The reflex on seeing upstream touch `_record_usage` — the function patch `0017`
exists because of — is "upstream absorbed it, delete the patch." Archaeology
says no. `_i()` comes from `a1e470b` ("llmcore: null-safe usage") and fixes a
`TypeError` when a provider sends explicit `null` in a usage field. That is
type safety on values that **arrive**. `0017` covers the compat-provider case
where the input side **never arrives** at `message_start` and only shows up on
the final `message_delta`. Different failure, no overlap; `0017` stays. The two
compose cleanly: `0017` passes already-`int` values into `_record_usage`, and
`_i` is idempotent on ints.

## The one real conflict: `0007` again

Second upgrade running, `0007` is the only patch that conflicts, and both times
for the same structural reason — it edits `llmcore.py` regions upstream is
actively working in.

This time upstream raised the context defaults on the exact line `0007` inserts
its codex credential block before:

```
<<<<<<< HEAD
        default_context_win = 35000; default_cut_msg_interval = 7
=======
        self.codex_backend = bool(cfg.get('codex_backend'))
        self.galley_api_key_ref = cfg.get('galley_api_key_ref') or ''
        ipc = cfg.get('galley_credential_ipc')
        self.galley_credential_ipc = ipc if isinstance(ipc, dict) else None
        default_context_win = 30000; default_cut_msg_interval = 5
>>>>>>> 0007-managed-codex-backend.patch
```

Resolution: keep the four codex lines, take upstream's new defaults. `0007` has
no stake in context sizing — that line is only in its hunk because zero-context
diffs drag adjacent lines along. Reverting upstream's engine tuning as a side
effect of a credential patch would have been a silent, unintended fork.

The other 15 patches replayed clean. Only `0001`, `0002`, `0007`, `0008`
changed on re-export, all `llmcore.py` line drift.

## Method note: the prediction was right, and it still needed the machine

The audit predicted that upstream's new `error` branch (landing at line 201)
would drift patch `0017`'s zero-context hunks, because it sits **between**
`0017`'s `message_start` hunk and its `message_delta` hunk. That is exactly the
shape that mis-drops silently under positional `git apply`.

What the prediction got wrong in detail: `0016` and `0017` re-exported
byte-identical. The commit-chain rebase resolves by three-way merge and
re-derives patches from the merged result, so the exported hunk headers are
self-consistent by construction — the arithmetic that *looked* like it should
shift them was reasoning about the wrong intermediate state. This is the
standing argument for not hand-shifting hunks: the line math is easy to get
wrong in a way that compiles.

Verification that the landing was semantically right, not just mechanically
clean: grepping the built payload's `_parse_claude_sse` confirmed
`input_recorded` at function top, the `message_start` assignment inside the
`message_start` branch, thinking accumulation with the raw `yield thinking`
removed, the tagged emit at `content_block_stop`, the `message_delta` fallback,
and upstream's `ConnectionError` **after** all of them. Plus
`test_managed_ga_llmcore.py`'s 15 tests, which exercise this payload directly.

## Hub: the product-direction signal is now a standing watch item

The headline of this range is upstream's hub growing a **P2P phone-pairing
sidecar**: bus and panel ports split with a token-authed panel, a 9-digit
2-minute pairing code exchanged for a durable room UUID, and the panel's
`/api/` prefix exported to a phone over WebRTC with an encrypted-relay fallback
through a hard-coded third-party signal server. The follow-up commits are all
bandwidth reduction for that relay (`since=` skeleton delta, `nt` rewind
marker, `seg ?off` tail fetch, `psig` peer-list delta, ~68% fewer bytes).

Inert on Galley's path — TCP, HTTP, token auth, and outbound tunnels are all
outside Rule 2 — but the shape deserves recording, because it is no longer just
a remote-viewing feature. Hub is a **federated peer bus**: any GA host calls
`hub.connect()` on itself and becomes addressable, and any local process can
then `put` a task to it or `abort` it. If a Galley session ever attached, those
calls would bypass Core's origin audit, confirmation tokens, and write-mode —
a direct breach of Rule 5.

Today the isolation is structural: `hub.connect()` sits inside `agentmain.py`'s
`if __name__ == '__main__':` block, and Galley imports `agentmain` as a module
(`runner/workbench_bridge.py:638`) rather than executing it. But that isolation
is **incidental, not designed** — upstream extended hub's attach surface from
`stapp` to `conductor`, `desktop_pet`, and now `reflect` inside a single week.
A `grep -rn "hub.connect" managed-ga/code/` at each upgrade is the cheap guard;
`runner/managed_im_supervisor.py`, which wraps upstream IM frontends, is the
second surface to watch.

The deeper question — hub peer bus vs Galley Core as overlapping capability
surfaces — JC took away to think about rather than decide here. Short version
of the survey: they are not competitors at the same layer. Hub is D-Bus
(federated, voluntary, zero persistence, no ownership); Galley Core is systemd
(authoritative, owns the runner processes, SQLite-backed, audited). Hub lacks
exactly what Galley exists to provide: persistence, a task board with claim
semantics, origin audit, confirmation gates, and write-mode control.

## Verification

- Byte-identity gate: old-chain replay reproduced the checked-in payload before
  rebasing (patch stack, manifest commit, and payload were in sync — no drift
  to repair this round).
- `build-managed-ga.sh` compile sweep: OK.
- `check-managed-ga-payload.mjs`: OK.
- `check-ga-baseline-drift.mjs --write` then clean re-run.
- `pytest runner/tests -m 'not e2e'` against `GA_PATH=/tmp/galley-ga-upgrade`:
  205 passed.
- `mypy runner` (strict): clean, 22 files. `ruff check runner`: clean.
- GA `pyproject.toml` diffed old-vs-new: zero change, so no
  `scripts/bundle-python.sh` update and no bundled-Python rebuild needed.

Not run this round: desktop dogfood in both runtime modes (SOP step 8) and the
bundled-runtime smoke (step 7, moot without a dependency change). Both are
release-gate work and belong to whichever release ships this baseline — the
raised `context_win` / `cut_msg_interval` defaults are the specific thing to
watch in long sessions.

## Housekeeping

`0016`'s ledger row was missing from `managed-ga/patches/manifest.md` — it had
been described only in the header note since it landed on 2026-08-03, leaving
the table at 15 rows for a 16-patch stack. Added in this pass with reason,
touched files, rebase risk, and removal condition, matching the discipline the
other rows follow.
