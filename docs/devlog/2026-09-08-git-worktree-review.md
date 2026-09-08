# Git worktree review in the reading panel

Date: 2026-09-08
Status: implemented; commit/push authorized; final desktop acceptance pending
Related: [interaction spec](../design/conversation.md#git-工作区改动审阅),
[transport contract](../agent-api/transports.md#git-review-v1-additive)

## Decision

JC approved separating process review (the existing per-tool diff in the
conversation) from result review (repository-wide net changes in the right
panel). A proposed session-wide file snapshot/attribution system was rejected
as too ambiguous and complex, especially for scripts and conversations with
no workspace. The first increment uses Git as its explicit baseline; ordinary
non-Git documents retain their existing reading experience.

The header's Changes action uses a remembered repository or project directory,
otherwise opens a native directory chooser flow. A Markdown preview can open
its enclosing repository through the More menu. Repository choice does not
bind the session or change its working directory. Worktrees are supported.

## Implementation

`react-diff-view` renders Git-generated patches, loaded only on opening review.
The existing compact `PatchView` remains in approvals/tool history. Pierre is
not selected for this increment: its earlier bundle concern remains historical,
not a new benchmark; the Git-patch-oriented renderer fits the current scope.
The initial production build puts the review component and dependencies in a
roughly 24 KiB gzip JavaScript chunk plus under 1 KiB gzip CSS (not a standalone
library-size measurement).

Rust owns read-only Git subprocesses via one additive `git.review` API on both
transports. Output/time limits, literal pathspecs, inherited Git-env removal,
disabled optional locks/fsmonitor/external diff/textconv/clean-process filters,
and bounded regular-file reads prevent review from invoking repository helper
commands or refreshing the index. Lazy object fetching and Git transports are
disabled, including for partial clones. Untracked traversal prunes hidden and OS
data directories before descending, as required by I12. No DB writes, runner
changes, external-engine modification, or repository initialization.

## Limits and rejected scope

- Baseline is current HEAD, not task start or Agent attribution. A moved HEAD
  requires refresh. Worktree contents are read on demand, not an atomic snapshot.
- Untracked content is separate; ignored, hidden-directory and OS-directory
  entries are excluded. Tracked changes in those directories remain visible.
- Renames appear as deletion/addition. Conflicts and submodules have explicit
  notices; this is not a merge editor or recursive submodule browser.
- No syntax highlighting in this increment. Line-level diff and bounded
  word-level highlighting are provided; only three adjacent context lines are
  shown. No full-context expansion, staging, revert, commit, or editing.
- Non-Git comparisons, session snapshot capture and task-only attribution are
  deferred. No automatic Git initialization or repository discovery scans.

## Verification and next

Temporary-repository tests cover combined staged/unstaged net changes, ignored
and untracked files, index preservation, unborn repositories, binary/size
limits, literal paths, worktrees, stale HEAD, conflicts, submodules, symlink
handling and disabled filters. A socket parity test exercises the shared API.
Renderer tests cover both layouts, inert source HTML and invalid/metadata-only
patches. GUI typecheck, lint, all 357 tests (44 files), and production build
pass. Cargo workspace check/full tests pass, followed by the focused Git tests
and socket parity test after boundary refinements. `git diff --check` passes.
The build retains existing chunk-size, mixed-import and Node deprecation warnings.

JC's next Dev acceptance should cover the header entry with/without a project,
Markdown-to-repository entry, file switching, refresh, narrow/wide transitions,
focus return, dark/light diff colors and continued conversation input. Git
availability and Windows paths/native directory selection need platform
dogfood; no Vite-only browser is treated as desktop acceptance.

## Topbar refinement

JC found the labeled Changes button inconsistent with adjacent toolbar controls,
and the GitDiff arrows insufficiently direct. The approved refinement moves the
entry into the utility cluster before reading-width controls, using the shared
28px icon button and a 16px single-color file/minus/plus glyph in Phosphor's thin
stroke style. Tooltip supplies the action; a quiet selected fill and
`aria-pressed` reflect the actual review state. The button closes an open Git
panel, opens it when absent, or switches from Markdown to Git review. Closing
from the toolbar returns focus to that button.

## Window-scoped review

JC confirmed that Git review should be independent of the conversation. The
reading workspace now stays mounted at window scope: switching sessions or
projects preserves repository, file selection, layout and the open Git panel.
Project paths are only initial candidates when no repository was chosen.
Markdown preview retains its prior session lifetime, including cancellation of
pending reads and no reappearance when returning to an earlier session. The
conversation subtree stays keyed by session to preserve its existing reset
behavior. JC authorized commit and push after this alignment and toolbar polish.
