# macOS 15 DMG release qualification

Run this on a real macOS 15 machine in a dedicated test account. The wrapper mounts the DMG,
copies its app into `/Applications` under a collision-safe qualification name, launches the production
binary, and later moves that exact app to a path containing spaces and Chinese characters.

```bash
frontends/desktop/release_qualification/macos/run_macos_release_qualification.sh \
  --artifact /path/GenericAgent-Desktop-macOS-aarch64.dmg \
  --expected-commit <candidate-sha> \
  --keep-work-dir
```

The release workflow builds this artifact on the explicit macOS 15 arm64 runner and names it
`aarch64`; it is not an Intel/universal binary. The app is ad-hoc signed only, not Developer ID
signed or notarized.

In addition to the shared chat/data/port/relocation checks, this qualification hard-fails if the DMG
does not contain the build-time `.prepared` marker or if any file inside the `.app` changes from
first launch through restart and relocation. It verifies the package bridge remains inside the
app while `GA_ROOT` points at an external core, then verifies a deleted override falls back to the
stable writable runtime at `~/Library/Application Support/GenericAgent/runtime/app`.

After automation, review Gatekeeper/open-anyway, traffic lights, focus, retry behavior, the native
directory picker, and visual/loading behavior. The report keeps those checklist values as supporting
notes, but the automated verifier does not require them to be edited to `pass`. The wrapper restores
the settings file exactly and removes its temporary `/Applications` copy; run it only in a dedicated
account because the normal Application Support runtime may be created.
