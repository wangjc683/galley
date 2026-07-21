"""Plan-mode visibility — read-only peek at GA's plan state.

GA's plan mode is entered by the agent itself (`plan_sop.md` →
`handler.enter_plan_mode(path)`); Galley deliberately provides no
entry point (see `.scratch/plan-mode-visibility/PRD.md`, decision
2026-07-21). This module only *observes*: once per turn_end the bridge
asks `PlanWatcher.snapshot()` whether there is a plan-state change
worth emitting as a `plan_update` IPC event.

Coupling points (Rule 1 — read-only, re-audit at GA baseline upgrades):

- Imports GA's ``frontends/plan_state.py`` (GA's own pure-stdlib plan
  parser; ``<ga_path>/frontends`` is put on sys.path by
  ``Bridge._setup_ga``). Only public helpers are used: ``is_active`` /
  ``resolve_path`` (both consult ``working['in_plan_mode']`` on the
  handler/agent — the same stash ``enter_plan_mode`` writes),
  ``extract`` / ``summary`` / ``is_complete`` (plan.md checklist
  parsing) and ``current_step`` (the ``📌 当前步骤`` convention from
  plan_sop.md).
- Reads the plan.md file that GA wrote. Never writes it.

External GA whose checkout predates ``plan_state.py`` → ImportError →
the watcher permanently disables itself and the feature is silently
off (the PRD's attach-mode degradation: nothing detected, nothing
shown, nothing written).
"""

from __future__ import annotations

from typing import Any

# Checklist size guard: plan_sop.md caps plans at a handful of steps,
# but a runaway plan.md shouldn't bloat every IPC event.
_MAX_ITEMS = 100


def _path_hint(path: str) -> str:
    """Last two segments of the plan path — enough for the GUI's
    placeholder card ("plan_x/plan.md") without leaking an absolute
    filesystem path into copy."""
    norm = (path or "").replace("\\", "/").rstrip("/")
    if not norm:
        return ""
    return "/".join(norm.split("/")[-2:])


class PlanWatcher:
    """Per-bridge plan-state tracker.

    ``snapshot`` returns the payload for a ``plan_update`` event when
    something should be emitted, else None. Stateful for three reasons:
    consecutive-duplicate suppression, the one-shot ``active: False``
    emit on plan exit, and carrying the last seen ``当前步骤`` across
    turns whose response didn't restate it.
    """

    def __init__(self) -> None:
        self._plan_state: Any = None
        self._unavailable = False
        self._was_active = False
        self._last_step = ""
        self._last_payload: dict[str, Any] | None = None

    def _module(self) -> Any:
        if self._unavailable:
            return None
        if self._plan_state is None:
            try:
                import plan_state  # type: ignore[import-not-found]
            except Exception:
                self._unavailable = True
                return None
            self._plan_state = plan_state
        return self._plan_state

    def snapshot(self, agent: Any, response_text: str = "") -> dict[str, Any] | None:
        ps = self._module()
        if ps is None:
            return None
        try:
            return self._snapshot(ps, agent, response_text)
        except Exception:
            # Observation must never disturb the turn stream; a parse
            # hiccup just means no plan event this turn.
            return None

    def _snapshot(
        self, ps: Any, agent: Any, response_text: str
    ) -> dict[str, Any] | None:
        # No messages passed → stash-only check (`working['in_plan_mode']`),
        # the strict signal enter_plan_mode writes. The legacy
        # message-scan fallback is for GA's own frontends restoring old
        # transcripts; the bridge sees the live agent and doesn't need it.
        if not ps.is_active(agent):
            if not self._was_active:
                return None
            # active → inactive transition: one closing event so the
            # GUI drops the bar (GA auto-exits when the checklist hits
            # zero open items).
            self._was_active = False
            self._last_step = ""
            return self._dedupe(
                {
                    "active": False,
                    "placeholder": False,
                    "done": 0,
                    "total": 0,
                    "complete": True,
                    "step": "",
                    "pathHint": "",
                    "items": [],
                }
            )

        self._was_active = True
        if response_text:
            step = ps.current_step([response_text])
            if step:
                self._last_step = str(step)

        path = ps.resolve_path(agent)
        items: list[tuple[str, str]] = []
        if path:
            try:
                with open(path, encoding="utf-8", errors="replace") as f:
                    items = list(ps.extract(f.read()))[:_MAX_ITEMS]
            except OSError:
                items = []

        if not items:
            # Plan mode entered but plan.md not written (or empty) yet.
            hint = _path_hint(path or self._stashed_path(agent))
            return self._dedupe(
                {
                    "active": True,
                    "placeholder": True,
                    "done": 0,
                    "total": 0,
                    "complete": False,
                    "step": self._last_step,
                    "pathHint": hint,
                    "items": [],
                }
            )

        done, total = ps.summary(items)
        return self._dedupe(
            {
                "active": True,
                "placeholder": False,
                "done": int(done),
                "total": int(total),
                "complete": bool(ps.is_complete(items)),
                "step": self._last_step,
                "pathHint": _path_hint(path or ""),
                "items": [{"content": c, "status": st} for c, st in items],
            }
        )

    @staticmethod
    def _stashed_path(agent: Any) -> str:
        """Raw ``working['in_plan_mode']`` value for the placeholder
        hint when the file doesn't resolve yet. Same (handler, agent)
        precedence as plan_state's own stash lookup."""
        for src in (getattr(agent, "handler", None), agent):
            working = getattr(src, "working", None)
            if isinstance(working, dict):
                value = str(working.get("in_plan_mode") or "").strip()
                if value:
                    return value
        return ""

    def _dedupe(self, payload: dict[str, Any]) -> dict[str, Any] | None:
        if payload == self._last_payload:
            return None
        self._last_payload = payload
        return payload
