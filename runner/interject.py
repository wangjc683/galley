"""What the user says while the main chat's run is going (main chat ticket 136).

Core hands each such message over with `interject` (`docs/ipc-protocol.md`
§5.15); this module keeps the runner's account of them and decides what GA's
`intervene` holds. GA reads `intervene` at the end of every step of its loop,
puts it in the next step's prompt as `[MASTER] …` and clears it
(`managed-ga/code/ga.py` `turn_end_callback`); the account answers three
questions:

- what `intervene` should hold now: the preamble, then every message not yet
  read, in the order sent, one blank line apart (`add`);
- which messages a step's end read, judged from what GA says it took
  (`step_ended`): a text this module wrote, at the end of a step after which
  the loop goes on. GA also reads `intervene` in the call that ends its loop
  (`agent_loop.py`: `turn_end_callback(..., '', exit_reason)`), whose prompt
  goes nowhere; that one delivers nothing (upstream's own TUI judges it the
  same way, `frontends/tuiapp_v2.py` `_install_intervene_replay_hook`);
- which messages a run's end leaves unread (`take_unread`), clearing
  `intervene` so none of them reaches the next run's first step.

GA reads and clears `intervene` on its agent thread while a new message can
arrive on the command thread, so a message written between GA's read and its
clear is wiped: `step_ended` writes back whatever is still unread. Every
write goes through the writer this account is given, under its lock.

The writer touches GA's attribute (`GaSession.set_intervene`), which the
constitution allows only in Galley's managed runtime: the bridge refuses
`interject` everywhere else, and this account writes nothing until it has
taken a message, so in attach mode it never writes at all (CLAUDE.md Rule 1).
"""

from __future__ import annotations

import threading
from collections.abc import Callable, Iterable


class Interjections:
    """The runner's account of the messages handed over mid-run."""

    def __init__(self, write: Callable[[str | None], None]) -> None:
        self._write = write
        self._lock = threading.Lock()
        # (id, text) not read yet, in the order sent.
        self._unread: list[tuple[str, str]] = []
        self._preamble = ""
        # Every id taken in this run, read or not: Core hands the messages
        # still in its queue over again when it starts a run, and one
        # already here must not go in twice.
        self._taken: set[str] = set()
        # Each text written since the last step's end, with the ids it
        # holds: what GA may have read.
        self._written: list[tuple[str, list[str]]] = []
        # `intervene` holds something this account wrote.
        self._dirty = False

    def add(self, items: Iterable[tuple[str, str]], preamble: str) -> list[str]:
        """Take messages for the run's next step. Returns the ids taken:
        those not taken before in this run."""
        with self._lock:
            fresh = [(i, t) for i, t in items if i not in self._taken]
            if not fresh:
                return []
            self._taken.update(i for i, _ in fresh)
            self._unread.extend(fresh)
            if preamble:
                self._preamble = preamble
            self._arm()
            return [i for i, _ in fresh]

    def step_ended(self, injected: str | None, run_goes_on: bool) -> list[str]:
        """A step of GA's loop ended. `injected` is what GA took from
        `intervene` for the next step's prompt (its hook locals); the
        messages in it were read only if the run goes on. Returns the ids
        read, in the order sent, and writes back what is still unread."""
        with self._lock:
            read: list[str] = []
            if injected and run_goes_on:
                for text, ids in reversed(self._written):
                    if text == injected:
                        read = ids
                        break
            if read:
                gone = set(read)
                self._unread = [(i, t) for i, t in self._unread if i not in gone]
            self._written.clear()
            if run_goes_on:
                # GA cleared `intervene`; put back what it did not take.
                self._arm()
            return read

    def take_unread(self) -> list[str]:
        """The run ended: clear `intervene` and return the ids it never
        read, in the order sent. The account starts over for the next
        run."""
        with self._lock:
            ids = [i for i, _ in self._unread]
            self._unread.clear()
            self._written.clear()
            self._taken.clear()
            self._preamble = ""
            if self._dirty:
                self._write(None)
                self._dirty = False
            return ids

    def _arm(self) -> None:
        """Write what is unread into `intervene` (or clear what this
        account wrote there). Under the lock."""
        if not self._unread:
            if self._dirty:
                self._write(None)
                self._dirty = False
            return
        text = compose(self._preamble, [t for _, t in self._unread])
        self._write(text)
        self._dirty = True
        self._written.append((text, [i for i, _ in self._unread]))


def compose(preamble: str, texts: list[str]) -> str:
    """What `intervene` holds: the preamble, then each message, one blank
    line apart."""
    parts = [preamble] if preamble else []
    parts.extend(texts)
    return "\n\n".join(parts)
