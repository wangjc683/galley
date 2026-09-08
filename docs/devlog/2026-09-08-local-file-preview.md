# Local file references and Markdown preview

Date: 2026-09-08
Status: implemented; JC-reported Dev desktop acceptance passed; unreleased
Related: [conversation design](../design/conversation.md#本地文件引用与-markdown-预览),
[API transport](../agent-api/transports.md#local-file-presentation-v1-additive)

## Context and decision

A user asked to open folders directly from paths in Agent replies. JC also
proposed reading generated Markdown inside Galley. Discussion converged on
completing the handoff from Agent output to human review: full file references
gain direct file-manager actions; Markdown gains a read-only preview beside
the conversation when space permits, or in a content dialog on narrow windows.
JC approved the conservative path scope and authorized implementation.

## Rejected directions

- Inferring relative chat paths from the project root: that root is not the
  runner's working directory, and tools may change directories independently.
- Turning all slash-containing prose/logs into links: too many commands,
  examples, and incomplete paths. Explicit links and full-path inline code
  are sufficient for the first increment.
- Building an artifact registry, file tree, editor, or multi-tab document
  workspace: a referenced file may be input, existing source, or output;
  its presence in a message does not establish deliverable identity.
- Automatic refresh: replacing the report while someone reads it disrupts
  review. Opening/refreshing reads current disk content, with no snapshot claim.

## Engineering choices

`local_file.access` is additive under schemaVersion 1; the Tauri presenter and
socket both delegate to `GalleyApi`. Rust bounds UTF-8 Markdown reads and
local raster image reads; image data URLs avoid expanding the WebView's
global asset scope for reports on external disks. No runner/managed-runtime
patches, database migration, directory scan, or file-content persistence.
Async reads are discarded after replacement, close, or session switch.

## Verification and next

GUI full suite (353 tests) and the subsequent focused path/rendering suite
(10 tests), typecheck, lint and production build pass. Cargo workspace check
and full workspace tests pass; local-file tests cover filename, content,
type and size boundaries, and the socket test verifies parity with the shared
API and existing error categories. The production build emits non-fatal
chunk-size and mixed static/dynamic import warnings.

Desktop acceptance remains: macOS Finder and Windows Explorer selection;
wide/narrow layout, focus return, rapid file switching and session switching;
document-relative images on another drive. No Vite-only browser dogfood was
used as a substitute for Tauri. Cross-file fragments currently open the
destination document at the top; same-document heading anchors work.


## Dogfood follow-up: resizable preview

JC's desktop test found that the fixed 46% preview could not use more of an
already large window. The agreed refinement uses the existing resizable-panel
library inside the main area: persist a global split, constrain both reading
areas by pixel minimums, and reset only this split on separator double-click.
The conversation Panel stays mounted when preview opens/closes or changes to
a narrow-window dialog, preserving its input and scroll state. Layout storage
uses separate panel-ID combinations for the single and split arrangements.
Text blocks retain a comfortable measure while tables, code and images can
use the wider preview. No editor, collapsible conversation, or new fullscreen
mode is introduced. Typecheck, lint and diff whitespace checks pass for this
refinement; the drag/layout behavior awaits desktop acceptance.

## Dogfood follow-up: file-manager button feedback

JC found that the tooltip was visible but the small folder icon's neutral
hover feedback was hard to notice. The agreed adjustment strengthens both
the message-side and preview-header folder buttons together: a brand-soft
hover surface, stronger icon color, and a stronger pressed fill with the
existing quiet 1px press. The shared `file-reveal-button` style preserves
geometry, instant hover, the desktop arrow cursor and existing error handling.
Opening the file manager supplies success feedback; no extra toast is added.

## Dogfood follow-up: clickable path feedback

JC confirmed the folder-button feedback in Dev, then found the clickable
path itself still felt static. The path now shares the folder button's hover
and pressed colors, within its own hit area. Hover also strengthens the
underline; inline-code backgrounds become transparent and their ink inherits
the button color so the existing code styling cannot hide that feedback.
Path text retains its geometry, including during press. Adjacent folder
buttons respond independently because they perform a different action.

## Desktop acceptance

On 2026-09-08, JC reported that testing passed after the clickable-path
feedback refinement and authorized commit and push. This supersedes the
pending Dev acceptance notes above for the tested desktop flow. The report
did not specify platform coverage; it does not establish separate macOS and
Windows acceptance for every scenario listed above. The feature remains
unreleased.
