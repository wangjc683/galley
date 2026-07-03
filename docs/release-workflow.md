# Release workflow

> Background, edge cases, and troubleshooting for shipping a Galley release.
> This is **not** the release-day runbook — for the step-by-step procedure
> (pre-flight, tag, review, smoke, publish, promote, verify), follow the
> [release / update SOP](./release-update-sop.md). Read this doc when a release
> goes off the happy path, or when you need the reasoning behind a step.

> Related
> - Release-day runbook: [`docs/release-update-sop.md`](./release-update-sop.md)
> - Workflow files: [`.github/workflows/release.yml`](../.github/workflows/release.yml) (tag-triggered build + draft Release) / [`.github/workflows/promote-update-channel.yml`](../.github/workflows/promote-update-channel.yml) (manual; publishes the default in-app update channel) / [`.github/workflows/check.yml`](../.github/workflows/check.yml) (three-platform build check on PR)
> - Windows manual build guide: [`docs/windows-build-checklist.md`](./windows-build-checklist.md) — when CI is unavailable or you need a local `.exe`

## Overview

```text
Development: local pnpm tauri dev (dogfood)
       ↓
Version bump (tauri.conf.json + package.json + Cargo.toml)
       ↓
git commit + git tag v0.2.0-alpha.1 + git push origin main v0.2.0-alpha.1
       ↓
GitHub Actions release.yml fires automatically
       │
       ├─ macos-15 (arm64 runner, native) → Galley_0.2.0-alpha.1_macOS_aarch64.dmg
       ├─ macos-15 (arm64 runner, cross)  → Galley_0.2.0-alpha.1_macOS_x64.dmg   ← cross-compile + Rosetta 2 since v0.1.2
       └─ windows-2022                    → Galley_0.2.0-alpha.1_Windows_x64-setup.exe
       ↓
ubuntu-latest collects artifacts + gh release create --draft
       ↓
Manual review: open the draft on the GitHub Release page, edit in release notes, download + smoke test locally
       ↓
Agent / automation stops here until the release owner confirms this exact draft build
       ↓
Click publish → user-visible + downloadable
       ↓
alpha / dogfood builds stop here for manual download only
stable / patch builds continue to Promote Update Channel → default update-channel manifest points at this version
```

Estimated build time: 4-7 min per platform job (with cache hits), three in
parallel. Push tag to draft-release-ready is roughly **10-12 min** end to end.

**Mac Intel CI path** (since v0.1.2): macos-15 arm64 runner + cross-compile +
Rosetta 2, validated by [trial run 26016317898](https://github.com/wangjc683/galley/actions/runs/26016317898).
Rosetta install ~3 min; cross-compile adds ~2-3 min vs native build. More
durable than keeping GitHub's deprecated macos-13 runner (on a 2026-27
deprecation path). Local build remains the fallback (see
[Manual fallback](#manual-fallback-ci-stalled-or-skipped) scheme B when CI is
unavailable or skipped).

**Windows ARM status**: the current release matrix only supports Windows x64.
Windows ARM needs a `windows-11-arm` / `aarch64-pc-windows-msvc` workflow job,
`bundle-python.sh win-arm64`, updater-manifest `windows-aarch64` generation and
validation, and a matching smoke path. Until those are in place, Windows ARM
is not a stable release asset.

## Version numbering

Semver 0.x.y, pre-1.0:

| Example | Meaning | Trigger |
|---|---|---|
| `v0.2.0` | feature release | new feature ships (e.g. Windows support lands) |
| `v0.2.1` | patch release | post-release bug fix / dogfood polish |
| `v0.2.0-alpha.1` | alpha pre-release | internal test / early adopter / dogfood |
| `v0.2.0-beta.1` | beta pre-release | dogfood build closer to public release |
| `v0.2.0-rc.1` | release candidate | final validation before stable |
| `v1.0.0` | first stable | user volume + auto-update ready + critical features stable |

Pre-release tags contain `-`, so CI auto-marks them prerelease and GitHub does
not promote them as "latest" to ordinary users.

## Release procedure

The end-to-end release procedure — pre-flight, commit version bump, tag and
push, wait for CI, review the draft, smoke, publish, promote, verify, dogfood —
lives in the [release / update SOP](./release-update-sop.md). That is the
authoritative runbook; follow it in order on release day. This document covers
only the background, edge cases, and troubleshooting the SOP intentionally
keeps terse.

## Hotfix procedure

For a severe bug found within 48h of release:

1. `git checkout -b hotfix/v0.2.1` from the `v0.2.0` tag (not from main — main
   may already carry un-released commits).
2. Fix the bug, add tests.
3. Bump to `v0.2.1`.
4. Merge back to main + tag + push.
5. Run the normal release procedure, but the RC can be skipped (small blast
   radius, small diff).

## Dry run

To verify that `release.yml` itself can complete the three-platform build
without actually releasing (no tag, no draft Release), use GitHub Actions
**manual dispatch**:

1. Open https://github.com/wangjc683/galley/actions/workflows/release.yml
2. Top right → **Run workflow** → pick `Branch: main` → click the green
   **Run workflow** button.
3. CI fires the full build matrix (three platforms in parallel).
4. The **release job is skipped automatically**
   (`if: startsWith(github.ref, 'refs/tags/v')` guard) — no Release is created,
   nothing is uploaded to any Release.
5. All three build jobs green = the CI workflow is healthy.
6. Artifacts are downloadable from the run detail page (retained 90 days); you
   can install one locally for smoke if you want.

Since auto-update was wired in, dry run also validates the updater signing
configuration. Before running it, the repo needs these in place:

- Secret: `TAURI_SIGNING_PRIVATE_KEY`
- Secret: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if the key has a password
- Variable: `GALLEY_UPDATER_PUBKEY`
- Variable: `GALLEY_UPDATER_ENDPOINT`

When to use a dry run:

- After a CI config change, to verify the matrix still builds (e.g. adjusting
  the matrix or upgrading action versions).
- When you suspect a platform broke but don't want to wait for the next real
  release to find out.
- To show a PR contributor that their change builds on all three OSes.

It produces no tag pollution in git history and no draft Release cluttering the
Releases page.

## Prerelease (RC) procedure

Almost identical to a stable release, with these differences:

- The tag contains `-` (e.g. `v0.2.0-rc.1`, `v0.2.0-rc.2`).
- CI auto-marks it prerelease; GitHub does not promote it as latest.
- Release notes are marked **RC**.
- No community announcement; internal dogfood only.

## Tiered release strategy

When platform / test coverage gaps are large, **split into multiple independent
releases**, each tagged with its own quality tier. Used during v0.1:

- macOS RC (author has fully smoked locally) → `v0.1.0-rc.1`
- Windows Alpha (author has no Windows machine; community dogfood) → `v0.1.0-alpha.1`

See [2026-05-15 v0.1 ship devlog §D1](./devlog/2026-05-15-v0.1-ship-and-ci-fallback.md#d1-tiered-releasemacos-rc--windows-alpha-分两个-release).

### Why not one combined release

Putting artifacts of different tiers into one release with a notes-level
explanation of the difference means users ignore the notes and download anyway,
ending up using Alpha quality as if it were RC. **Two releases give a hard
visual separation**: the Release list shows "macOS RC (Latest)" + "Windows Alpha
(Pre-release)" as two entries, and the meaning is obvious at a glance.

### When to use tiered

- Large platform smoke-coverage gap (e.g. Mac tested + Windows not tested).
- Large feature-readiness gap (e.g. Mac complete + Windows has a known feature
  gap).
- Large audience gap (e.g. existing Mac users + Windows is a new platform).

### Tag naming

Semver-compatible prerelease suffixes, ordered by confidence high to low:

| Suffix | Meaning |
|---|---|
| `vX.Y.Z` | final / stable |
| `vX.Y.Z-rc.N` | Release Candidate |
| `vX.Y.Z-beta.N` | Beta |
| `vX.Y.Z-alpha.N` | Alpha |

Different platforms in a tiered release use different suffixes, **but the
version-number base should be the same** (all `vX.Y.Z`) so the same code line is
traceable.

### Latest badge + cross-link

To make the repo sidebar show a tiered release, remove the prerelease flag and
mark it Latest (see the SOP's publish step; GitHub does not let a prerelease be
Latest). Cross-link tiered releases in their notes:

```markdown
Same code as [macOS RC v0.1.0-rc.1](https://.../tag/v0.1.0-rc.1) → theoretically same features
```

So users know there are releases for other platforms.

## Manual fallback: CI stalled or skipped

When CI-built artifacts are unavailable, use the manual fallback path.

### Triggers

In priority order:

1. ⏳ macos-13 Intel runner **queue > 30 min** → fallback (see
   [CI troubleshooting](#ci-troubleshooting)).
2. ❌ One platform's build fails but others are OK → fallback (use the
   successful platforms' artifacts + leave the failed platform for later).
3. 🚫 You simply don't want to run CI (already built locally + high confidence
   + urgent) → fallback.

### Full command sequence

```bash
# 1. Cancel the stuck or unwanted CI run
gh run list --workflow=release.yml --limit 3   # find the run ID
gh run cancel <run-id>

# 2a. Download successful CI artifacts locally
gh run download <run-id> -n galley-macos-15-aarch64   # → Galley_X.Y.Z_macOS_aarch64.dmg
gh run download <run-id> -n galley-windows-2022-x64   # → Galley_X.Y.Z_Windows_x64-setup.exe

# 2b. Local build for self-arch (Mac x64 / aarch64) — remember to rename
cd gui && pnpm tauri build --target x86_64-apple-darwin
../scripts/rename-artifact.sh x86_64-apple-darwin
# artifact: core/target/x86_64-apple-darwin/release/bundle/dmg/Galley_X.Y.Z_macOS_x64.dmg

# 3. Draft the GitHub Release notes to /tmp/galley-<tag>-notes.md
# Use the templates in docs/release-notes-guide.md.

# 4. Create a draft release (don't publish directly — leave it for review)
gh release create vX.Y.Z-rc.N \
  --draft --prerelease \
  --title "Galley vX.Y.Z-rc.N · macOS (Release Candidate)" \
  --notes-file /tmp/galley-rc-notes.md \
  Galley_X.Y.Z_macOS_aarch64.dmg \
  Galley_X.Y.Z_macOS_x64.dmg

# 5. Open the draft on GitHub UI (Markdown render / files / metadata)

# 6. publish
gh release edit vX.Y.Z-rc.N --draft=false

# 7. To mark Latest (must drop the prerelease flag first)
gh release edit vX.Y.Z-rc.N --prerelease=false --latest
```

### Key notes

- **Don't forget the `--prerelease` flag** in step 4 — an RC/Alpha release
  should be prerelease. The tier is conveyed by title + notes; the prerelease
  flag is the GitHub-level marker.
- **Keep local-build artifact filenames identical to CI artifacts**
  (`Galley_X.Y.Z_<arch>.<ext>`); consistent naming avoids user confusion.
- **A wasted CI run during manual fallback is harmless** — `release.yml`'s
  `release` job always fails to reach the failed / stuck `build` job
  (`needs: build`), so it never auto-creates a Release. No conflict.
- **Tag pushed but no release appeared?** The tag is already on origin →
  `gh release create <tag>` uses the existing tag; no `--target` flag needed.

## CI troubleshooting

### Symptom: macos-13 runner won't schedule

GitHub Actions occasionally queues certain runners. Waiting 5-10 min usually
resolves it.

**Persisting beyond 30 min**:

1. Check https://www.githubstatus.com for overall Actions status — if it's a
   platform-wide outage, wait.
2. If only macos-13 is queued → **switch to manual fallback** (see
   [Manual fallback](#manual-fallback-ci-stalled-or-skipped)):
   - Cancel the stuck run.
   - Use the other platforms' built artifacts + a local `pnpm tauri build` for
     the missing arch.
   - `gh release create` to produce the release manually.
3. Root cause: macos-13 is a deprecated runner (see
   [Intel runner deprecation](#intel-runner-deprecation)); unreliable long-term.

The v0.1 release (2026-05-15) went this way — see
[2026-05-15 v0.1 ship devlog](./devlog/2026-05-15-v0.1-ship-and-ci-fallback.md).

### Symptom: cargo check linker error on Windows

Usually a Rust + MSVC version-combination issue. Check whether
`dtolnay/rust-toolchain@stable` resolved to an incompatible version. Temporary
workaround: pin a Rust version (e.g. `dtolnay/rust-toolchain@1.78`).

### Symptom: pnpm lockfile mismatch

`pnpm install --frozen-lockfile` enforces a strict lockfile. If you changed
dependencies recently but forgot to commit `pnpm-lock.yaml`, CI fails. Run
`pnpm install` locally once and commit the lockfile.

### Symptom: tauri build on Windows reports missing NSIS resources

The `bundle.windows.nsis.installerIcon` path is wrong. Check the icon config in
`core/tauri.conf.json`.

### Symptom: `release` job can't find artifacts after upload

`actions/download-artifact` with `merge-multiple: true` flattens all artifacts
under `artifacts/`. If `softprops/action-gh-release`'s `files: artifacts/**/*`
matches nothing, the build job's `path` glob is wrong. Inspect the release
job's `List artifacts` step output.

## Intel runner deprecation

GitHub has marked the `macos-13` runner deprecated (no public shutdown date, but
estimated end of 2026 to 2027). **Since v0.1.0-alpha.2 Galley has removed
macos-13 from the CI matrix** — ahead of GitHub's forced shutdown.

Fallback paths taken, in chronological order:

- **v0.1.0-alpha.2 / v0.1.1-alpha.1**: scheme B — JC's local Intel Mac build +
  `gh release upload` to attach manually.
- **v0.1.2 onward**: scheme C — macos-15 arm64 runner cross-compiles x86_64 +
  Rosetta 2 install, fully CI-automated. Trial-validated 2026-05-18,
  [run 26016317898](https://github.com/wangjc683/galley/actions/runs/26016317898),
  merged to main as the default CI behavior.

### Scheme C (current main path, since v0.1.2)

The second row of the `release.yml` matrix:

```yaml
- platform: macos-15
  target: x86_64-apple-darwin
  arch: x64
  bundle_dir: dmg
  bundle_glob: "*.dmg"
```

With a conditional Rosetta install step
(`if: matrix.target == 'x86_64-apple-darwin'`):

```yaml
- name: Install Rosetta 2 (x86_64 cross-compile on arm64 host)
  if: matrix.target == 'x86_64-apple-darwin'
  run: softwareupdate --install-rosetta --agree-to-license
```

`bundle-python.sh mac-x64` downloads the x86_64 PBS Python tarball and runs
`pip install` for the GA deps on the arm64 host via Rosetta 2.
`pnpm tauri build --target x86_64-apple-darwin` cross-compiles the Mac Intel
binary. `hdiutil` produces the x86_64 `.dmg` automatically.

Trial-verified binary arch:

```
Galley.app/Contents/MacOS/desktop:                Mach-O x86_64 ✓
Galley.app/Contents/Resources/python/bin/python3.11:  Mach-O x86_64 ✓
```

Timing: ~7 min vs arm64 native ~4 min (Rosetta install +~3 min, cross-compile
+~0 min on a cached Rust target).

### Scheme B (fallback only, since v0.1.2)

When CI stalls / urgent hotfix / Rosetta install fails after a runner-image
update, a local build still works:

- On an Intel Mac: `pnpm tauri build --target x86_64-apple-darwin`
- `scripts/rename-artifact.sh x86_64-apple-darwin` inserts the `macOS` slug
- `gh release upload v<X.Y.Z> Galley_<X.Y.Z>_macOS_x64.dmg` attaches to the
  same Release

### Scheme A (drop Intel Mac support)

No longer considered — with scheme C working, Intel CI maintenance cost is
manageable, and Intel Mac share among early Galley users is still meaningful.

History: scheme B from 2026-05-15 alpha.2; validated + merged scheme C as the
main path after the 2026-05-18 v0.1.1-alpha.1 ship.

## Announcement templates

Per-release announcements are written to a throwaway `/tmp/galley-announce-{zh,en}.md`
file each release, used once, and **not committed to the repo**. The structure is
recreated from scratch each time — there is no in-repo template body to maintain.
For the release-day flow itself, follow the
[release / update SOP](./release-update-sop.md).

## Future work (v0.6+)

### Code signing

To eliminate the "unsigned app" warning on first launch:

**macOS (Apple Developer Program, $99/year)**:
- Apply for a Developer ID Application certificate.
- Add CI secrets: `APPLE_CERTIFICATE` (.p12 base64) +
  `APPLE_CERTIFICATE_PASSWORD` + `APPLE_ID` + `APPLE_PASSWORD` +
  `APPLE_TEAM_ID`.
- Add codesign + notarize steps to `release.yml`.
- One-time effort ~2-3 h + $99/year.

**Windows (code-signing certificate, $200-400/year)**:
- Buy a certificate from SSL.com / Sectigo.
- Add CI secret: signing cert + password.
- Add a signtool step to `release.yml`.
- One-time effort ~1-2 h + annual fee.

**Decision point**: invest only once there is real user volume beyond the
dogfood group.

### Auto-update (`tauri-plugin-updater`)

Phase one has wired in the check-for-update entry in Settings → About / Runtime
and the post-launch background check. When a new version is found, it downloads
and prepares the update in the background, then waits for the user to restart
to apply it. It is only truly enabled when both of these release configs are
provided:

- `GALLEY_UPDATER_PUBKEY`: the Tauri updater public key embedded in the app
- `GALLEY_UPDATER_ENDPOINT`: HTTPS updater-manifest URL
- `TAURI_SIGNING_PRIVATE_KEY`: Tauri updater private key, as a GitHub Secret
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: optional, if the key has a password

Until configured, the UI shows "Dev build not connected to an update channel",
but Dev and local builds are unaffected. Generate the key pair:

Protection logic: as long as any session is running, Galley will not download /
install / relaunch an update. The background check can remember "new version
found" and continue preparing it only after all tasks finish.

```bash
pnpm --dir gui tauri signer generate -w ~/.config/galley/updater.key
```

`updater.key.pub` is the base64 public key Tauri needs. You can decode it to
check it round-trips to a minisign public key, but do not put the decoded
two-line text into the GitHub Variable:

```bash
base64 -D < ~/.config/galley/updater.key.pub
```

Where to configure:

- GitHub Secrets:
  - `TAURI_SIGNING_PRIVATE_KEY`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, if you set a password when generating
    the key
- GitHub Variables:
  - `GALLEY_UPDATER_PUBKEY`: the contents of `updater.key.pub`
  - `GALLEY_UPDATER_ENDPOINT`

The release workflow writes a temporary
`core/tauri.updater.generated.conf.json` in CI, merging the public key /
endpoint into the Tauri config and turning on `bundle.createUpdaterArtifacts`.
CI already prepares the CLI sidecar in a separate step, so this temporary config
also narrows `beforeBuildCommand` to `pnpm --dir gui build` to avoid re-running
bash-only repo scripts during the Windows Tauri-bundle phase. The workflow
uploads updater artifacts:

- macOS: `Galley_<version>_macOS_<arch>.app.tar.gz` and `.sig`
- Windows: `Galley_<version>_Windows_x64-setup.exe` and `.sig`

Windows ARM updater artifacts are not generated yet; enabling them requires
synchronously updating `scripts/generate-tauri-update-manifest.mjs` and
`scripts/check-update-channel.mjs`, otherwise the live-manifest validation will
drift from the release assets.

The release workflow also drops a `latest.json` candidate into the draft Release
for review. The manifest that actually affects users is published to the default
in-app update channel by `promote-update-channel.yml`:

```text
https://raw.githubusercontent.com/wangjc683/galley/galley-update-channel/updates/stable/latest.json
```

`updates/beta/latest.json` is kept as a legacy alias so older installed builds
still receive later updates.

Manifest rules:

- `signature` in the manifest must be the `.sig` file's contents, not the
  `.sig` URL.
- `url` in the manifest points at the corresponding platform's updater package.
- The live channel must pass
  `scripts/check-update-channel.mjs --cache-bust` before it counts as published.
- Do not depend on `/releases/latest/download/latest.json` as the update
  channel; use the explicit `galley-update-channel` endpoint above to avoid
  leaking draft / prerelease / pre-smoke versions.

### Linux builds

`ubuntu-latest` runner + AppImage / deb packaging. Low priority, waiting for
real Linux users to ask.
