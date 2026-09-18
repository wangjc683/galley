# External GA image input through a one-shot `backend.ask` wrapper

Date: 2026-09-18
Status: implemented; headless attach-mode e2e passed; JC desktop dogfood
passed for image input and for the auto-title fix (2026-09-18); unreleased
Related: [managed image patch 0008](../../managed-ga/patches/manifest.md),
[IPC protocol §4.1 / §4.12](../ipc-protocol.md), [GA baseline contract
surface item 11](../ga-baseline.md#contract-surface),
[v0.2.12 image intake release](./2026-06-23-v0212-image-intake-and-ga-upgrade-release.md)

## Context

External-GA users reported that the composer offers no image input while
the bundled engine has it. JC had forgotten why the June feature shipped
bundled-only. The reason is in commit `6f403829`: "external GA, where
upstream drops the image". Upstream `GenericAgent.put_task(images=)` has
accepted image paths since 2026-03-13, but upstream `run()` never reads
`task["images"]`, and `NativeToolClient.chat` drops every non-text block
before calling `backend.ask`. The bundled runtime fixes both with patch
`0008`; attach mode may not patch the user's checkout (Rule 1), so the GUI
gated intake on `runtimeKind === "managed"` and the v0.2.7 devlog left an
open question: implement a Galley-native path or wait for upstream.

What changed since June: upstream's Desktop 2.0 (`f0d5bc7`, 2026-08-23)
gave its own `frontends/desktop_bridge.py` an image path that does not
touch `run()` either. `_patch_chat_for_images` wraps
`agent.llmclient.backend.ask` for one call before `put_task` and appends
base64 image blocks to the first user message. Upstream's own frontend
therefore delivers images to an unpatched engine by wrapping the LLM
client in-process, which is exactly the seam attach mode can use.

## Decision

Mirror upstream's wrapper in the runner for attach mode, with three guards
upstream does not have:

- the bridge disarms the wrapper at run end (all three `run_complete`
  sites share `_end_run_tracking`), so a task aborted before its first LLM
  call cannot leak its images into the next task;
- the wrapper skips a message that already carries an image block, so if
  upstream `run()` ever consumes `images` itself, nothing doubles up while
  patch `0008` and the wrapper are removed together;
- it installs only on upstream's `NativeToolClient`, the one client whose
  `backend.ask` receives a block list; other clients report
  `imagesSupported: false`.

The runner reports `imagesSupported` on `ready` and again on `llm_changed`
(switching model swaps the backend). Core carries the field with a `true`
default for older runners; the GUI gate becomes "managed, or the runner did
not say no". The empty-state composer is optimistic because no bridge
exists yet; if images then arrive at a runner that cannot deliver them, the
text still goes out and a business warning says the images did not.

AGENTS.md Rule 1 now lists the wrapper as an allowed attach-mode
integration point. It was not literally banned (the ban names
`agent_runner_loop` and tool implementations), but it does alter what the
LLM receives, one step beyond "Galley-namespaced in-memory attributes", so
it earned an explicit line rather than a reading of the gaps.

## Rejected alternatives

- **Upstream PR making `run()` consume `images`** (port of patch 0008's
  consumption side). Cleanest long-term, and the day it lands both 0008
  and the wrapper go. Not pursued now: merge timing is not ours, external
  users would have to update their checkout, and upstream itself chose
  the ask-level wrapper for its desktop frontend. Recorded in deferred.
- **Path hint in the prompt text.** GA has no image-viewing tool; the model
  cannot see pixels from a path.
- **Injecting the image into `backend.history` before `put_task`.** The
  restore seam is allowed, but this would be a fake prior turn, confuse
  the transcript, and stretch "read / inject history for restore" past its
  purpose.
- **Keeping the empty-state composer gated for external runtimes.** No
  runner exists yet to ask; in practice every current GA config uses
  `NativeToolClient`, and the runner's warning covers the miss.

## Verification

- Runner: 258 unit tests green (`pytest`), `mypy` strict clean, `ruff`
  clean. New tests cover: append-once-then-restore, disarm of an uncalled
  wrapper on abort, no duplicate when an image block is present,
  unsupported client emits the business warning and still dispatches the
  text, managed mode leaves delivery to patch 0008, re-arm replaces a stale
  wrapper and restores a pre-existing instance-level `ask`.
- Core: `cargo test` for the ipc module plus workspace; the two events
  deserialize with and without the field.
- GUI: `typecheck`, `lint`, vitest green.
- Headless e2e against JC's `~/Documents/GenericAgent` (upstream `1b6442f`,
  `NativeOAI/gpt-6-astra`): a generated blue-left / yellow-right PNG sent
  as a `user_message` attachment; turn 1 answered "blue on the left,
  yellow in the middle, and orange on the right" (the orange is the
  model's, not the file's), and a text-only turn 2 asking what the earlier
  image contained answered "blue, yellow, and orange" without tools, which
  confirms the in-place append also lands in `backend.history`.
  `imagesSupported` arrived `true` on `ready`.

## Open

- JC's desktop dogfood covered image send + recognition on
  `NativeClaude/glm-5.3-flash` and the auto-title after the fix below. The
  abort-before-first-call path and a model switch mid-session rest on the
  unit tests; watch them in real use.
- User-visible difference that remains by design: an external runtime on a
  legacy client (`ToolClient` / `LLMSession`) shows no 📎 and a "model
  backend cannot receive images" toast; the bundled engine never enters
  that state.

## Postscript: attach-mode auto-title leaked native reasoning

JC's desktop dogfood passed the image path (a YouTube thumbnail described
correctly on `NativeClaude/glm-5.3-flash`) but the session title read "The
user wants a short conversation title. The conversation". Not the image
change: `side_ask` concatenated the streamed chunks of `backend.raw_ask`,
and unpatched upstream yields `thinking_delta` raw into that stream (patch
`0016` tags it in the bundled runtime, which is why JC never saw it there).
With `reasoning_effort: high` the model also spent more than the 30 s title
deadline before its first text chunk, so the sidebar got whatever prefix of
the reasoning had arrived; a headless rerun produced the single word "The".

Fix, two parts: `side_ask` now reads the generator's return value, which
every Native* session types as `thinking` / `text` blocks, and joins only
the text blocks (streamed text stays the fallback when no block list comes
back); a deadline cut returns "" instead of the partial stream so a
half-answer never reaches the sidebar, and the title deadline rises from
30 s to 90 s (daemon worker, seed title meanwhile, Core's CAS write ignores
a late title after a rename). Headless rerun on glm-5.3-flash: "乔丹视频缩略
图解析"; on gpt-6-astra: "乔丹大学时期的无球打法". Contract-surface item 11
in ga-baseline records the `raw_ask` return-value coupling.

Also observed in the same dogfood and left alone by JC's call: the
answer footer's token line (↑ / ↓) stays bundled-only. It comes from GA's
`cost_tracker`, which the runner installs only in managed mode, and on
Anthropic-compatible endpoints the input side would read 0 in attach mode
anyway without patch `0017`. Not deferred, not planned: the bundled engine's
experience is the first priority, and a half-filled invoice line on external
runtimes would raise more questions than it answers.
