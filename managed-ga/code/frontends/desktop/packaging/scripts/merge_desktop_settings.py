#!/usr/bin/env python3
"""Update or detach package-owned Desktop paths without dropping user settings."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--settings", required=True, type=Path)
    parser.add_argument("--project-dir", required=True)
    parser.add_argument("--python-path")
    parser.add_argument("--bridge-script")
    parser.add_argument("--remove-bundle")
    args = parser.parse_args()

    sys.path.insert(0, str(Path(args.project_dir).resolve() / "frontends"))
    from desktop_settings import merge_package_paths, remove_bundle_paths

    if args.remove_bundle:
        if args.python_path or args.bridge_script:
            parser.error("--remove-bundle cannot be combined with path updates")
        remove_bundle_paths(args.settings, args.remove_bundle)
        return
    if not args.python_path or not args.bridge_script:
        parser.error("--python-path and --bridge-script are required when updating settings")
    merge_package_paths(
        args.settings,
        python_path=args.python_path,
        project_dir=args.project_dir,
        bridge_script=args.bridge_script,
    )


if __name__ == "__main__":
    main()
