#!/usr/bin/env bash
set -euo pipefail

# Create a git worktree for one ticket, branched from local `main`.
# See docs/agents/dispatch.md for when and why.
#
# The main worktree is the first entry of `git worktree list --porcelain`, so
# the result is the same whichever worktree this is called from.

LOG_PREFIX="[new-ticket-worktree]"

usage() {
  cat <<'USAGE'
Usage: scripts/new-ticket-worktree.sh <name> [--rust] [--dir <parent>]

  <name>          Ticket short name, e.g. 152 or dispatch-01.
                  Branch: ticket/<name>
                  Path:   <parent>/<main-worktree-dir-name>-wt-<name>
  --rust          Also clone core/target/debug, core/target/tauri-sidecars,
                  core/python-bundle and core/gen from the main worktree
                  (APFS clonefile on macOS) so the first cargo build is
                  incremental, not full.
  --dir <parent>  Parent directory for the worktree.
                  Default: the main worktree's parent directory.

Examples:
  scripts/new-ticket-worktree.sh 152
  scripts/new-ticket-worktree.sh dispatch-01 --rust --dir "$TMPDIR"
USAGE
}

NAME=""
RUST=0
PARENT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rust)
      RUST=1
      shift
      ;;
    --dir)
      if [[ -z "${2:-}" ]]; then
        echo "${LOG_PREFIX} --dir needs a directory" >&2
        exit 2
      fi
      PARENT="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "${LOG_PREFIX} unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [[ -n "$NAME" ]]; then
        echo "${LOG_PREFIX} unexpected argument: $1" >&2
        usage >&2
        exit 2
      fi
      NAME="$1"
      shift
      ;;
  esac
done

if [[ -z "$NAME" ]]; then
  echo "${LOG_PREFIX} missing <name>" >&2
  usage >&2
  exit 2
fi

BRANCH="ticket/${NAME}"
if ! git check-ref-format --branch "$BRANCH" >/dev/null 2>&1 || [[ "$NAME" == */* ]]; then
  echo "${LOG_PREFIX} not a usable ticket name: ${NAME}" >&2
  exit 2
fi

MAIN_WT="$(git worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')"
if [[ -z "$MAIN_WT" || ! -d "$MAIN_WT" ]]; then
  echo "${LOG_PREFIX} could not resolve the main worktree" >&2
  exit 1
fi

if [[ -z "$PARENT" ]]; then
  PARENT="$(dirname "$MAIN_WT")"
fi
if [[ ! -d "$PARENT" ]]; then
  echo "${LOG_PREFIX} parent directory does not exist: ${PARENT}" >&2
  exit 1
fi
PARENT="$(cd "$PARENT" && pwd)"

WT="${PARENT}/$(basename "$MAIN_WT")-wt-${NAME}"

if git -C "$MAIN_WT" show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  echo "${LOG_PREFIX} branch already exists: ${BRANCH}" >&2
  exit 1
fi
if [[ -e "$WT" ]]; then
  echo "${LOG_PREFIX} path already exists: ${WT}" >&2
  exit 1
fi
if ! git -C "$MAIN_WT" show-ref --verify --quiet refs/heads/main; then
  echo "${LOG_PREFIX} no local main branch" >&2
  exit 1
fi

echo "${LOG_PREFIX} creating ${WT} on ${BRANCH} from local main"
git -C "$MAIN_WT" worktree add -b "$BRANCH" "$WT" main

echo "${LOG_PREFIX} pnpm install"
pnpm --dir "${WT}/gui" install --frozen-lockfile

if [[ "$RUST" -eq 1 ]]; then
  if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "${LOG_PREFIX} not macOS: skipping clone, the first build is a full build"
  else
    for rel in core/target/debug core/target/tauri-sidecars core/python-bundle core/gen; do
      src="${MAIN_WT}/${rel}"
      dest="${WT}/${rel}"
      if [[ ! -d "$src" ]]; then
        echo "${LOG_PREFIX} skip ${rel}: not present in the main worktree"
        continue
      fi
      if [[ -e "$dest" ]]; then
        echo "${LOG_PREFIX} skip ${rel}: already present in the new worktree"
        continue
      fi
      echo "${LOG_PREFIX} cloning ${rel}"
      mkdir -p "$(dirname "$dest")"
      cp -cR "$src" "$dest"
    done
    rm -rf "${WT}/core/target/debug/incremental"
  fi
fi

cat <<DONE
${LOG_PREFIX} ready
  worktree: ${WT}
  branch:   ${BRANCH}
  remove:
    git -C "${MAIN_WT}" worktree remove "${WT}"
    git -C "${MAIN_WT}" branch -d ${BRANCH}
DONE
