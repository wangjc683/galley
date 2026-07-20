#!/usr/bin/env bash
set -euo pipefail

# Rebase the managed GA patch stack onto a new upstream baseline.
#
# Mechanizes the commit-chain method from docs/ga-baseline.md (introduced
# in the 2026-07-15 upgrade): replay the CURRENT patch stack as git
# commits on the CURRENT baseline, byte-verify the result against the
# checked-in payload, `git rebase --onto` the new baseline, and re-export
# every commit as a zero-context patch file. Hand-fixing positional
# zero-context hunks one by one is exactly what mis-drops them.
#
# Usage:
#   scripts/rebase-managed-ga-patches.sh <new_sha> [source_repo]
#   scripts/rebase-managed-ga-patches.sh --export-only <workdir>
#
#   <new_sha>     Target upstream commit (must exist in source_repo).
#   [source_repo] GenericAgent checkout to clone from.
#                 Default: /tmp/galley-ga-upgrade (the SOP's clean clone).
#   --export-only Resume after resolving a rebase conflict by hand:
#                 finish `git rebase --continue` inside <workdir>, then
#                 run this to re-verify and export the patches.
#
# The old baseline and the patch list are read from
# managed-ga/manifest.json — run this BEFORE updating the manifest to the
# new commit. Exported patches overwrite managed-ga/patches/*.patch;
# afterwards update the manifest and rerun build-managed-ga.sh.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NORMALIZE_LIST="$ROOT/scripts/managed-ga-normalize-files.txt"
PATCH_DIR="$ROOT/managed-ga/patches"

normalize_tree() {
  local tree="$1" rel
  while IFS= read -r rel; do
    [[ -z "$rel" || "$rel" == \#* ]] && continue
    [[ -f "$tree/$rel" ]] && perl -0pi -e 's/[ \t]+$//mg; s/\n*\z/\n/' "$tree/$rel"
  done < "$NORMALIZE_LIST"
}

patch_touched_files() {
  # All b/ paths across the current patch stack (for the byte-identity check).
  # Parse the `diff --git a/… b/…` headers, not `+++` lines: binary hunks carry
  # no `+++`, so a `+++`-only scan silently skips added binary files (the 0015
  # icon PNGs) from the byte-identity check.
  sed -n 's|^diff --git a/.* b/||p' "$PATCH_DIR"/*.patch | sort -u
}

verify_chain_matches_payload() {
  local tree="$1" rel bad=0
  while IFS= read -r rel; do
    if ! cmp -s "$tree/$rel" "$ROOT/managed-ga/code/$rel"; then
      echo "  MISMATCH vs checked-in payload: $rel" >&2
      bad=1
    fi
  done < <(patch_touched_files)
  if [[ $bad -ne 0 ]]; then
    echo "Old-chain replay does not reproduce managed-ga/code." >&2
    echo "Patch stack, manifest commit, and payload are out of sync — fix that first." >&2
    exit 2
  fi
}

# Strip `index <sha>..<sha>` lines from TEXT hunks only. They churn on every
# rebase and `git apply --unidiff-zero` does not need them, so dropping them
# keeps the checked-in text patches stable. Binary hunks are the opposite:
# `git apply` reconstructs the blob from the `index` line's SHAs, so a
# `GIT binary patch` block MUST keep its index line, and `git diff` only emits
# the literal/delta payload when passed `--binary`. Omitting either silently
# degrades a binary hunk to a `Binary files ... differ` placeholder — which is
# how patch 0015's icon PNGs vanished on re-export in the 2026-07-20 upgrade.
strip_text_index_lines() {
  awk '
    function flush(   i) {
      for (i = 0; i < n; i++) {
        if (!bin && buf[i] ~ /^index /) continue
        print buf[i]
      }
      n = 0; bin = 0
    }
    /^diff --git / { flush() }
    { buf[n++] = $0; if ($0 ~ /^GIT binary patch/) bin = 1 }
    END { flush() }
  '
}

# A commit touches a binary file iff `git diff --numstat` reports it as `-\t-`.
commit_touches_binary() {
  git -C "$1" diff --numstat "$2^" "$2" | awk '$1 == "-" && $2 == "-" { f = 1 } END { exit !f }'
}

export_patches() {
  local work="$1" c name
  git -C "$work" -c core.quotepath=false rev-list --reverse new-base..chain |
  while IFS= read -r c; do
    name="$(git -C "$work" log -1 --format=%s "$c")"
    case "$name" in
      *.patch) ;;
      *) echo "Unexpected commit subject (not a patch filename): $name" >&2; exit 2 ;;
    esac
    git -C "$work" diff -U0 --binary "$c^" "$c" | strip_text_index_lines > "$PATCH_DIR/$name"
    # Round-trip guard: a commit that touched a binary file must export a
    # `GIT binary patch` block, or the patch is un-appliable. Catches any
    # regression in the --binary / index handling on the spot.
    if commit_touches_binary "$work" "$c" && ! grep -q '^GIT binary patch' "$PATCH_DIR/$name"; then
      echo "Exported $name dropped its binary hunk — needs 'git diff --binary' + kept index lines." >&2
      exit 2
    fi
    echo "exported: $name"
  done
  echo
  echo "Next steps:"
  echo "  1. Update managed-ga/manifest.json upstream.commit / upstream.auditedAt"
  echo "  2. ./scripts/build-managed-ga.sh <clean_checkout_at_new_sha>"
  echo "     (its compile sweep is the mis-drop gate)"
  echo "  3. node scripts/check-managed-ga-payload.mjs && node scripts/check-ga-baseline-drift.mjs"
}

if [[ "${1:-}" == "--export-only" ]]; then
  WORK="${2:?usage: --export-only <workdir>}"
  if [[ -e "$WORK/.git/rebase-merge" || -e "$WORK/.git/rebase-apply" ]]; then
    echo "Rebase still in progress in $WORK — finish 'git rebase --continue' first." >&2
    exit 2
  fi
  export_patches "$WORK"
  exit 0
fi

NEW_SHA="${1:?usage: rebase-managed-ga-patches.sh <new_sha> [source_repo]}"
SOURCE="${2:-/tmp/galley-ga-upgrade}"
OLD_SHA="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["upstream"]["commit"])' "$ROOT/managed-ga/manifest.json")"

WORK="$(mktemp -d /tmp/galley-ga-patch-rebase.XXXXXX)/repo"
echo "Old baseline (from manifest): $OLD_SHA"
echo "New baseline (target):        $NEW_SHA"
echo "Work repo:                    $WORK"

git clone -q "$SOURCE" "$WORK"
git -C "$WORK" config user.email galley-rebase@localhost
git -C "$WORK" config user.name galley-rebase

# 1. Old chain: normalized old baseline + one commit per patch, in
#    manifest order. Applying with the same flags as build-managed-ga.sh.
git -C "$WORK" checkout -qb chain "$OLD_SHA"
normalize_tree "$WORK"
git -C "$WORK" commit -qam normalize-old
BASE_COMMIT="$(git -C "$WORK" rev-parse HEAD)"
while IFS= read -r patch_name; do
  git -C "$WORK" apply --unidiff-zero --whitespace=nowarn --recount "$PATCH_DIR/$patch_name"
  # `git add -A`, not `commit -am`: -am only stages modifications to already
  # tracked files, so a patch that ADDS files (0015's icon PNGs) would apply to
  # the worktree but never enter the chain commit — dropping the additions from
  # the rebase and the re-export entirely.
  git -C "$WORK" add -A
  git -C "$WORK" commit -qm "$patch_name"
  echo "replayed: $patch_name"
done < <(python3 -c 'import json,sys
for p in json.load(open(sys.argv[1]))["patchStack"]["patches"]: print(p)' "$ROOT/managed-ga/manifest.json")

# 2. Byte-identity: the replayed chain must reproduce the checked-in
#    payload for every patch-touched file, or the starting point is wrong.
verify_chain_matches_payload "$WORK"
echo "Old-chain replay matches checked-in payload."

# 3. New base: normalized target baseline.
git -C "$WORK" checkout -qb new-base "$NEW_SHA"
normalize_tree "$WORK"
git -C "$WORK" commit -qam normalize-new --allow-empty

# 4. Rebase the chain. --empty=drop removes patches upstream absorbed
#    verbatim (remember to also delete them from the manifest + docs).
git -C "$WORK" checkout -q chain
if ! git -C "$WORK" rebase --onto new-base "$BASE_COMMIT" chain --empty=drop; then
  echo
  echo "Rebase stopped on a real conflict. Resolve it by hand:"
  echo "  cd $WORK"
  echo "  # edit conflicted files, git add, git rebase --continue (repeat)"
  echo "Then export the regenerated patches:"
  echo "  $0 --export-only $WORK"
  exit 3
fi

export_patches "$WORK"
