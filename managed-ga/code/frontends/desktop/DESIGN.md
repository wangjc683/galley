# GenericAgent Desktop 2.0 integration boundary

GenericAgent Desktop 2.0 is a packaged Tauri desktop application with a generated React renderer and
Desktop-specific Python services. The React source is intentionally developed outside this upstream tree;
the generated distribution and all runtime interfaces required to execute it are tracked here.

## Renderer ownership

- `frontends/desktop/dist/**` contains the generated Desktop 2.0 HTML, JavaScript, CSS, fonts, and images.
- `frontends/desktop/static/**` is the independent Desktop v1 implementation and remains available unchanged.
- Tauri packages `dist/**`; it does not compile React during an upstream build.
- The public React source, issue tracker, and contribution home is
  <https://github.com/abraxas914/GenericAgent>.
- The exact fork commit and generated-file content manifest are recorded in
  `dist/build-provenance.json`.

Generated files must not be edited by hand. Renderer changes are made and tested in the fork, rebuilt from an
accepted fork `main` commit, and submitted upstream as a refreshed `dist/**` tree with matching provenance.
The manifest identifies the submitted bytes; it is not a claim that later builds are bit-for-bit reproducible.

The production Tauri configuration loads only the tracked asset origin and applies an explicit Content Security
Policy. React source tooling is absent from the upstream package path, while WebDriver permission remains isolated
to `tauri.e2e.conf.json` and is not granted by the production configuration.

## Desktop runtime ownership

Desktop 2.0 uses these repository-owned integration layers:

- `frontends/desktop_bridge.py`: local HTTP/WebSocket API, model/session/upload/data routes, service control,
  identity, and Desktop diagnostics.
- `frontends/conductor.py`: Desktop collaboration and model-routing integration.
- `frontends/cost_tracker.py`: Desktop usage and cost ledger.
- `frontends/data_backup.py`: validated Desktop data export, inspection, and import/merge behavior.
- `frontends/desktop_settings.py`: locked, atomic read/modify/write updates for shared Desktop preferences.
- `frontends/desktop/src-tauri/**`: native bootstrap, permissions, file pickers, runtime/source switching,
  process/port recovery, window behavior, and package resource resolution.

The package-owned bridge remains the executable service boundary. `GA_ROOT` can point it at a compatible
external GenericAgent repository, but does not replace the package-owned bridge or Tauri shell.

Desktop data import first backs up the complete destination `memory/**` tree, then applies source-wins memory
files. Model responses remain add-only, and Desktop sessions are de-duplicated by session ID. Activation is staged
and rolled back on failure. Import is rejected while a managed session or Desktop extra has unfinished work; users
must also stop any independent TUI, CLI, or automation process before importing because those external processes
are outside the bridge's maintenance gate. The persistent cost ledger is initialized by the Desktop bridge only;
existing TUI and conductor processes retain their previous in-memory accounting hot path.

Browser-origin requests are accepted only from the production Tauri origins, the fixed development origin, the
explicit E2E origin, or the bridge's own same origin. Native clients without an Origin remain supported, while
cross-site, null, lookalike, wrong-port, preflight, and WebSocket requests are rejected before route handling.
Backup exports cannot be written into any managed data or HTTP-readable directory.

Managed-service state is based on the bridge-owned live child process, not merely a listener on the configured
port. A foreign conductor on production port `8900` is reported as an external port conflict and is never stopped
or counted as an owned running extra. The alternate conductor port is available only to the isolated package E2E
journey; production renderer and CSP contracts remain fixed to `8900`.

On macOS, the package runtime uses a stable writable root and is refreshed through a package/build/source marker
with staged atomic activation. A previously shipped versioned runtime is migrated into that stable root. User
configuration, memory, responses, sessions, and token ledger data are preserved; a failed migration or activation
restores the previous runtime and marker. Matching markers keep the hot-start copy untouched.

## Core runtime boundary

Desktop 2.0 does not own or modify GenericAgent's Agent/LLM/Harness business runtime. In particular, the
integration does not change `agentmain.py`, LLM execution, Harness/Agent execution, inference, tool-calling,
or memory-scheduling semantics. Desktop bridge and conductor changes translate Desktop requests onto those
existing core contracts.

## Version and release contract

Desktop package metadata is `0.2.1` across npm, Cargo, Tauri, and generated provenance. Upstream packages consume
the tracked `dist/**` tree, so an upstream maintainer can build official Windows, Linux, and macOS artifacts
without the React source. A `desktop-portable-*` tag starts three read-only platform builders. One separate
publisher receives write permission only after all three succeed, validates the six expected files and checksums,
creates an invisible draft with all assets, and then exposes that single entry as a prerelease. Manual
`workflow_dispatch` runs produce candidate artifacts only and skip the publisher.

The Linux builder runs on Ubuntu 22.04, isolates Rust target/bin caches from newer runner ABIs, and rejects any
ELF requiring a GLIBC version newer than 2.35. Windows remains unsigned and documents SmartScreen plus checksum
verification; macOS remains ad-hoc signed and unnotarized.

The renderer still uses the existing local loopback bridge contract. This integration neither treats that inherited
platform requirement as a new release blocker nor claims to have changed operating-system loopback policy.

## Validation layers

- Compiled distribution contract: required entries, asset references, source-map/source leakage, E2E markers,
  version consistency, exact provenance manifest, and the `dist` package entry.
- Python contracts: bridge, conductor, model routing, sessions, uploads, cost ledger, `GA_ROOT`, and data backup.
- Rust contracts: formatting, clippy, production and E2E feature tests, and
  path/identity/port/diagnostic/bootstrap behavior.
- Native package contract: Linux Tauri build smoke plus the platform release workflow.

Optional platform release qualification lives under `frontends/desktop/release_qualification/**`.
Its automated evidence gate validates package behavior and cleanup; screenshots and manual visual checklists
remain separate release-owner review material rather than CI pass/fail inputs.

The richer React unit/browser/native E2E suites remain in the fork and run before its accepted `main` SHA is
used to refresh the generated upstream distribution.
