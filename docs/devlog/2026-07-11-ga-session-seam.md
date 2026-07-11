# 2026-07-11 — GaSession: the GA-internals seam becomes a module

## Outcome

`runner/ga_session.py` is now the ONE module that touches GenericAgent
internals. The constitution's (Rule 1) "re-audit every internal coupling
at each baseline upgrade" obligation previously meant grepping ~10
inline reach-ins across `workbench_bridge.py`; the audit surface is now
one file read top to bottom. `Bridge.ga` is a property over
`self.agent`, so the existing test pattern (swap in a `FakeAgent`) gets
a matching adapter for free.

Motivating friction (2026-07-11 architecture review, candidate 3 — the
last of the four Strong candidates): the allowed-integration-points list
existed as prose in the constitution but no code artifact WAS that seam;
the hooks dict alone had two writers 790 lines apart, each with its own
copy of the same defensive guard.

## Decisions (grilling 2026-07-11)

1. **Scope rule: "the re-audit obligation surface."** GaSession wraps
   exactly the internal/underscore/backend touches — `_turn_end_hooks`
   (register/unregister), `backend.history` (read/set/extend +
   `context_usage`), `llmclient.last_tools`, `_ga_project_mode_*`,
   the `agentmain.GenericAgentHandler` module binding. GA's public API
   (`next_llm`, `verbose`, `inc_out`, `put_task`) stays direct — the
   constitution explicitly allows it and wrapping it hides nothing
   upgrade-fragile. `managed_runtime.install_managed_prompt_profile`
   (the only other backend write) stays a named sibling seam — it's
   shared with the Bridge-less `managed_im_supervisor` path; GaSession's
   module doc cross-references it.
2. **`set_history` gains a loud guard.** The old `_load_history`
   docstring promised backend-agnosticism but was validated only for
   `NativeClaudeSession`; other session classes got a silent blind
   write (PRD §10). Now: same write, plus a returned warning the Bridge
   surfaces as a `severity: warning` error event. Silent possible
   corruption → visible possible corruption; no behavior change on the
   validated path. (Hard-fail rejected: some shapes may be compatible
   today; refusing would turn "maybe degraded" into "definitely
   broken".)
3. **Pet goes through the seam, PetController extraction deferred.**
   The pet's hook register/unregister now call GaSession (duplicate
   guard deleted); the full ~140-line lifecycle extraction stays on the
   quick-win list as its own round.
4. **`_on_turn_end` purification deferred.** Only its agent-touching
   fragment (`_context_snapshot`) moved (thin delegate to
   `ga.context_usage()`); the telemetry-math testability problem is a
   separate review item.

The desktop-shape → GA-native-blocks message adaptation
(`message_to_content_blocks` + image helpers) moved with the seam —
it exists solely to translate at this boundary.

## Verification

- New `runner/tests/test_ga_session.py` (13 tests, SimpleNamespace
  fakes): hook register/unregister idempotence + two-writer
  coexistence, history read/set/extend, the unvalidated-backend warning
  path, `clear_last_tools` tolerance, `context_usage` estimation +
  degradation, project-mode attrs, handler rebinding, message/image
  adaptation.
- Full suite: 187 passed (e2e deselected as usual), `mypy runner`
  strict clean, `ruff check runner` clean. `test_workbench_bridge.py`
  logic untouched (only the moved helper's import path).

## Next-baseline-upgrade note

The upgrade SOP's coupling re-audit now starts at `ga_session.py`
(plus the two documented file-level couplings that are not agent-object
touches: `tool_usable_history.json` read in `_handle_reinject_tools`,
and `managed_runtime.install_managed_prompt_profile`).
