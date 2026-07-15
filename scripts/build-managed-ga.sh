#!/usr/bin/env bash
set -euo pipefail

# Build the source-tree managed GA code payload from a local GenericAgent
# checkout. This script copies code only; user state and secrets are excluded.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="${1:-$HOME/Documents/GenericAgent}"
DEST="$ROOT/managed-ga/code"
STATE_SEED_ROOT="$ROOT/managed-ga/state-seed"
MEMORY_SEED_DEST="$STATE_SEED_ROOT/memory"
EXPECTED_COMMIT="$(python3 - "$ROOT/managed-ga/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    print(json.load(f)["upstream"]["commit"])
PY
)"
MANAGED_PATCHES=()
while IFS= read -r patch_name; do
  MANAGED_PATCHES+=("$patch_name")
done < <(python3 - "$ROOT/managed-ga/manifest.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    for patch in json.load(f)["patchStack"]["patches"]:
        print(patch)
PY
)

if [[ ! -d "$SOURCE/.git" ]]; then
  echo "Source is not a git checkout: $SOURCE" >&2
  exit 2
fi

ACTUAL_COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
if [[ "$ACTUAL_COMMIT" != "$EXPECTED_COMMIT" ]]; then
  echo "GenericAgent baseline mismatch:" >&2
  echo "  expected: $EXPECTED_COMMIT" >&2
  echo "  actual:   $ACTUAL_COMMIT" >&2
  echo "Update managed-ga/manifest.json only after a baseline audit." >&2
  exit 2
fi

if [[ -n "$(git -C "$SOURCE" status --porcelain)" ]]; then
  echo "GenericAgent source checkout must be clean before building managed GA." >&2
  echo "Use a clean temporary clone at the audited upstream commit." >&2
  git -C "$SOURCE" status --short >&2
  exit 2
fi

mkdir -p "$DEST"
find "$DEST" -mindepth 1 -maxdepth 1 \
  ! -name '.gitignore' \
  ! -name 'README.md' \
  -exec rm -rf {} +

rsync -a \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.venv' \
  --exclude 'venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude 'mykey.py' \
  --exclude 'mykey.json' \
  --exclude 'memory' \
  --exclude 'sop' \
  --exclude 'skills' \
  --exclude 'temp' \
  --exclude 'model_responses' \
  "$SOURCE"/ "$DEST"/

# Single source of truth for the normalize list is
# scripts/managed-ga-normalize-files.txt — shared with
# rebase-managed-ga-patches.sh so patch replay and patch rebasing always
# normalize the same set.
NORMALIZE_FILES=()
while IFS= read -r rel; do
  [[ -z "$rel" || "$rel" == \#* ]] && continue
  NORMALIZE_FILES+=("$DEST/$rel")
done < "$ROOT/scripts/managed-ga-normalize-files.txt"

# Normalize incidental upstream trailing spaces before patch replay so patch
# contexts do not need to encode whitespace-only upstream artifacts.
for file in "${NORMALIZE_FILES[@]}"; do
  [[ -f "$file" ]] && perl -0pi -e 's/[ \t]+$//mg; s/\n*\z/\n/' "$file"
done

rm -rf "$MEMORY_SEED_DEST"
mkdir -p "$STATE_SEED_ROOT"
git -C "$SOURCE" archive "$EXPECTED_COMMIT" memory | tar -x -C "$STATE_SEED_ROOT"
find "$MEMORY_SEED_DEST" -type f -print0 | xargs -0 perl -0pi -e 's/[ \t]+$//mg; s/\n+\z/\n/'

for patch_name in "${MANAGED_PATCHES[@]}"; do
  patch="$ROOT/managed-ga/patches/$patch_name"
  if [[ ! -f "$patch" ]]; then
    echo "Managed GA patch listed in manifest is missing: $patch_name" >&2
    exit 2
  fi
  (cd "$ROOT" && git apply --unidiff-zero --whitespace=nowarn --recount --directory=managed-ga/code "$patch")
  echo "Applied managed GA patch: $patch_name"
done

# Upstream sometimes ships incidental trailing spaces. Keep the generated
# checked-in payload compatible with Galley's `git diff --check` gate without
# baking whitespace-only removals into patch files that would fail that same gate.
for file in "${NORMALIZE_FILES[@]}"; do
  [[ -f "$file" ]] && perl -0pi -e 's/[ \t]+$//mg; s/\n*\z/\n/' "$file"
done

# Patch mis-drop gate: the managed patches are zero-context (positional),
# so after upstream line shifts a hunk can land in the wrong place without
# `git apply` failing. A full compile sweep turns that silent corruption
# into a build failure (the 2026-07-15 upgrade caught two such mis-drops
# only via compilation). __pycache__ is removed afterwards so the
# checked-in payload stays byte-clean.
find "$DEST" -name '*.py' -print0 | xargs -0 python3 -m py_compile
find "$DEST" -name '__pycache__' -type d -prune -exec rm -rf {} +
echo "Managed GA payload compile sweep: OK"

echo "Managed GA code copied to $DEST"
echo "Managed GA memory seed copied to $MEMORY_SEED_DEST"
