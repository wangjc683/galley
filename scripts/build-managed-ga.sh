#!/usr/bin/env bash
set -euo pipefail

# Build the source-tree managed GA code payload from a GenericAgent clone.
# The payload is read from the pinned baseline commit itself (`git archive`),
# never from the clone's working tree, so ignored, untracked or uncommitted
# files there cannot reach it. This script copies code only; user state,
# secrets and the upstream media in scripts/managed-ga-excluded-paths.txt
# are left out.

usage() {
  cat <<'EOF'
Usage: scripts/build-managed-ga.sh <genericagent-clone>

  <genericagent-clone>  Any clone of upstream GenericAgent that contains the
                        baseline commit named by upstream.commit in
                        managed-ga/manifest.json. Its checked-out branch and
                        working tree do not matter: the payload is read from
                        that commit. A fresh clone is the expected source:

    git clone https://github.com/lsdefine/GenericAgent.git <genericagent-clone>
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi
if [[ $# -ne 1 || -z "$1" ]]; then
  usage >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE="$1"
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

if ! git -C "$SOURCE" rev-parse --git-dir >/dev/null 2>&1; then
  echo "Source is not a git repository: $SOURCE" >&2
  usage >&2
  exit 2
fi

if ! git -C "$SOURCE" cat-file -e "${EXPECTED_COMMIT}^{commit}" 2>/dev/null; then
  echo "GenericAgent baseline commit not found in $SOURCE:" >&2
  echo "  expected: $EXPECTED_COMMIT (managed-ga/manifest.json upstream.commit)" >&2
  echo "Fetch it into that clone, or clone upstream afresh." >&2
  echo "Update managed-ga/manifest.json only after a baseline audit." >&2
  exit 2
fi

# The baseline commit's tracked tree, unpacked outside the repo. Only what
# upstream committed is here, whatever the clone's working tree holds.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/galley-managed-ga-build.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
git -C "$SOURCE" archive "$EXPECTED_COMMIT" | tar -x -C "$STAGE"

# Upstream media the payload leaves out, one named path per line (single
# source of truth: scripts/managed-ga-excluded-paths.txt, also read by the
# payload gates). A path the baseline no longer has stops the build, so the
# list is pruned at the upgrade that makes an entry stale.
while IFS= read -r rel; do
  [[ -z "$rel" || "$rel" == \#* ]] && continue
  if ! git -C "$SOURCE" cat-file -e "${EXPECTED_COMMIT}:${rel}" 2>/dev/null; then
    echo "Excluded upstream path is not in the baseline: $rel" >&2
    echo "Remove it from scripts/managed-ga-excluded-paths.txt (and the docs that name it)." >&2
    exit 2
  fi
  rm -rf "${STAGE:?}/$rel"
  echo "Excluded upstream path: $rel"
done < "$ROOT/scripts/managed-ga-excluded-paths.txt"

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
  "$STAGE"/ "$DEST"/

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

# managed-ga/code carries upstream's own .gitignore. A new upstream file
# under a path it ignores lands on disk here (so dev works), but a plain
# `git add` skips it and CI and releases ship without it. Stop until it is
# force-added; once tracked it no longer shows up here.
IGNORED_OUTPUT="$(git -C "$ROOT" ls-files --others --ignored --exclude-standard -- managed-ga/code managed-ga/state-seed)"
if [[ -n "$IGNORED_OUTPUT" ]]; then
  echo "The built payload has files git ignores (managed-ga/code carries upstream's .gitignore):" >&2
  printf '%s\n' "$IGNORED_OUTPUT" >&2
  echo "Stage them with 'git add -f' so CI and releases ship them." >&2
  exit 2
fi

echo "Managed GA code copied to $DEST"
echo "Managed GA memory seed copied to $MEMORY_SEED_DEST"
