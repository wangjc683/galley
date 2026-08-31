# Ubuntu 24.04 release qualification

Run this on a real Ubuntu 24.04 x64 desktop in a dedicated test account. FUSE must be available.
A screenshot tool (`gnome-screenshot`, `scrot`, or ImageMagick `import`) supplies optional review
evidence when present.

```bash
frontends/desktop/release_qualification/linux/run_linux_release_qualification.sh \
  --artifact /path/GenericAgent-Desktop-Linux-Portable.tar.gz \
  --expected-commit <candidate-sha> \
  --keep-work-dir
```

The wrapper verifies/extracts the tar, preserves the AppImage launch path, and runs the shared
production qualification. It covers package shape, embedded Python, first launch, warm
restart, package-owned bridge plus external `GA_ROOT`, deterministic chat, upload, memory import,
foreign-port protection, recovery after release, relocation into a path containing spaces and
Chinese characters, stale-override fallback, optional P2P degradation, screenshots, and cleanup.

After automation passes, review the Linux manual items: executable bit and desktop launcher,
window dragging/close behavior, retry button after port release, native directory picker, and
visual/loading behavior. The report retains these checklist values for notes, but the automated
evidence verifier does not require them to be edited to `pass`.
