# GenericAgent React Desktop 2.0 — compiled distribution

This directory contains the v0.2.1 generated HTML, JavaScript, CSS, fonts, images, and license notices for the
GenericAgent React Desktop 2.0 renderer. It is build output, not the React development tree.

## Source and contributions

The public React source of truth and the place for renderer issues, pull requests, and design feedback is:

- <https://github.com/abraxas914/GenericAgent>
- Exact source used for this distribution:
  [`4a67226e18cb003db1210357ea4a283774773acc`](https://github.com/abraxas914/GenericAgent/commit/4a67226e18cb003db1210357ea4a283774773acc)

Over the two-month React Desktop 2.0 development cycle, [abraxas914](https://github.com/abraxas914) led the new
renderer architecture and UI, Desktop bridge and Tauri integration, startup and recovery surfaces, package
validation, browser/native end-to-end coverage, renderer security hardening, and bundle optimization. Please
open an Issue or pull request in the fork above when proposing React renderer changes so source and generated
output stay synchronized.

[yiqi-017](https://github.com/yiqi-017) contributed user-facing help and feedback contacts that remain in the
compiled renderer, including the
[`help and feedback` settings work](https://github.com/abraxas914/GenericAgent/commit/5ddf03bb152666637bdfcfa44f1fac3cff5a66b6)
and [`startup recovery` support contacts](https://github.com/abraxas914/GenericAgent/commit/2fb55d944e4444b08cb9ad76c13aef7a5788186b).
He also produced an earlier
[`compiled-only delivery` prototype](https://github.com/abraxas914/GenericAgent/commit/3e7ca6a2b20eefdb3ee335dc0d520c3b6d9d57f8)
that helped establish this upstream packaging boundary. The current generated tree was rebuilt by abraxas914
from the exact merged source commit recorded above.

## Third-party software: Semi Design

This distribution contains code from these nine Semi Design packages, all resolved at version `2.101.0`:

- `@douyinfe/semi-animation`
- `@douyinfe/semi-animation-react`
- `@douyinfe/semi-animation-styled`
- `@douyinfe/semi-foundation`
- `@douyinfe/semi-icons`
- `@douyinfe/semi-illustrations`
- `@douyinfe/semi-json-viewer-core`
- `@douyinfe/semi-theme-default`
- `@douyinfe/semi-ui`

- Project: <https://github.com/DouyinFE/semi-design>
- Website: <https://semi.design>
- Copyright (c) 2021 DouyinFE
- License: MIT

The complete license text and bundled third-party notices are in
[`THIRD_PARTY_NOTICES.txt`](./THIRD_PARTY_NOTICES.txt) in this directory.

## Repository boundary

- `frontends/desktop/dist/**` is the generated React Desktop 2.0 renderer used by the packaged Tauri app.
- `frontends/desktop/static/**` remains the independent legacy Desktop v1 implementation; this distribution
  neither replaces nor modifies its source files.
- The complete Desktop 2.0 integration also uses the repository's Desktop-specific bridge, conductor, cost
  tracking, data-backup, bootstrap, permissions, and Tauri shell code.
- The integration does **not** modify GenericAgent's Agent, LLM, Harness, inference, tool-calling, or memory
  scheduling core runtime.
- `build-provenance.json` records the source repository, exact source commit, generated file count, and a
  content-manifest SHA-256. This README and the provenance file are excluded from that manifest. The manifest
  identifies this exact generated tree; it is not a claim that later builds are bit-for-bit reproducible.

Upstream maintainers can package the tracked distribution directly without the React source. React changes
should be built and validated in the fork, then submitted here as a refreshed generated tree with updated
provenance and matching Desktop integration contracts.
