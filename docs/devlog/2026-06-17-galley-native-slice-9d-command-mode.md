# Galley Native Slice 9D Command Mode

Date: 2026-06-17

Status: hidden explicit command mode landed. No public Agent API, schema, GUI,
managed GA default execution, Browser Control execution, or runtime behavior
changed.

## Context

Slice 9D-B made the report contract executable with fixtures. The next risk was
jumping straight to automatic managed/native runs: that would couple the
comparator to model availability, Core socket state, managed GA setup, browser
readiness, and external workspace side effects all at once.

The safer next step is to let the operator provide the exact managed and native
commands to compare, while the comparator owns isolation, capture, and report
writing.

## Implemented

- Extended hidden `galley native-parity report` with `--mode command`.
- Command mode requires exactly one supported scenario: P01, P03, P04, P14, or
  P18.
- Command mode requires both `--managed-command` and `--native-command`.
- Each side runs in an isolated workspace subdirectory:
  - `managed/`
  - `native/`
- The runner sets:
  - `GALLEY_PARITY_RUNTIME`
  - `GALLEY_PARITY_WORKSPACE`
- Reports now include optional `managed.commandStatus` and
  `native.commandStatus` fields for command-mode evidence:
  - exit code;
  - timeout flag;
  - stdout/stderr previews;
  - truncation flags;
  - duration;
  - workspace path.
- Explicit `--workspace` paths are preserved. Auto-created temp workspaces are
  cleaned up by default.
- Native failure with managed success yields `fail`; managed failure yields
  `blocked` because the baseline is unavailable.

## Decisions

- Do not ship automatic managed/native command presets yet.
- Do not compare exact stdout text as parity. The output preview is evidence for
  human review, not the judge.
- Keep this command hidden and internal. It is not part of the public CLI
  contract.
- Keep P08 and P19 out of command mode for now. Browser and fallback need their
  own readiness and operator-flow evidence.

## User Impact

No normal user behavior changes. For native rollout work, the impact is that we
can now collect real process evidence in the same report shape without making
the comparator guess how to launch managed GA, native sessions, or browser
state.

## Next

- Use command mode locally against real managed/native P01/P03/P04/P14/P18
  commands.
- Add automatic presets only after command-mode evidence shows the launch
  contract is stable.
- Keep P08 Browser Control and P19 fallback as separate live-evidence work.
