# Desktop release qualification

`run_release_qualification.py` is the common production-package runner. Platform wrappers install
or extract one artifact produced from a candidate commit and invoke it against the production binary.
It temporarily uses the real per-user settings path, restores it byte-for-byte, and therefore
must run in a dedicated Windows/Linux/macOS test account.

Every platform report records the candidate commit, artifact SHA-256, OS/architecture, bootstrap
snapshots, bridge identity/PIDs, package paths before and after relocation, screenshots, redacted
fake-model transcript, data results, cleanup status, and a short manual checklist. Screenshots and
manual checklist values are supporting material for the release owner; they do not determine the
automated evidence gate result.

After all three reports and the Windows native retry report are complete, combine them:

```bash
python3 frontends/desktop/release_qualification/verify_release_evidence.py \
  --expected-commit <candidate-sha> \
  --windows <windows-production-contract-report.json> \
  --linux <linux-real-package-report.json> \
  --macos <macos-real-package-report.json> \
  --windows-native-report <windows-e2e-report.json> \
  --output <candidate-evidence-manifest.json>
```

The verifier fails on a commit mismatch, missing artifact digest, failed automated scenario,
incomplete bootstrap evidence, missing macOS app immutability proof, or unclean final process/port
state. The release owner still reviews the screenshots and platform checklists separately before
publishing. The manifest is evidence for the candidate SHA; it is not committed to the repository.
