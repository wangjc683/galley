#!/usr/bin/env python3
"""Render every app icon, the avatar asset and the README icon from the master.

The inputs live in core/icons/master/ (README.md there explains the shapes):

  galley-icon.svg       the master: square, full bleed, no corners
  app-icon-rounded.svg  the master as a rounded square filling the canvas
  app-icon-macos.svg    the master on Apple's macOS icon grid, with a shadow

Each input goes through the Tauri CLI's own generator (`pnpm --dir gui tauri
icon`, which renders an SVG with its built-in resvg straight at every target
size) into a temporary directory, and only the files that input is for are
copied into core/icons/:

  app-icon-rounded.svg -> 32x32.png 64x64.png 128x128.png 128x128@2x.png
                          icon.png icon.ico Square*Logo.png StoreLogo.png
  app-icon-macos.svg   -> icon.icns
  galley-icon.svg      -> ios/ and android/ (replaced whole; iOS rounds the
                          corners itself)

It also copies the master to gui/src/assets/galley-icon.svg (the assistant's
avatar, AssistantAvatar.tsx; a test keeps the two identical) and the rounded
256px PNG to docs/assets/galley-icon.png (the README icon). The tray icons
(tray-template.png, tray-windows.png) are separate drawings and untouched.

    pnpm --dir gui install          # once: provides the Tauri CLI
    scripts/render-app-icons.py
    scripts/render-readme-assets.py # README banners and social preview

Needs only Python 3 and pnpm.
"""

from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ICONS = ROOT / "core/icons"
MASTER = ICONS / "master"

ROUNDED = [
    "32x32.png", "64x64.png", "128x128.png", "128x128@2x.png", "icon.png", "icon.ico",
    "StoreLogo.png", *(f"Square{n}x{n}Logo.png" for n in (30, 44, 71, 89, 107, 142, 150, 284, 310)),
]
MACOS = ["icon.icns"]
SQUARE_DIRS = ["ios", "android"]


def tauri_icon(src: pathlib.Path, out: pathlib.Path) -> None:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        sys.exit("pnpm not found")
    if not (ROOT / "gui/node_modules/.bin/tauri").exists():
        sys.exit("Tauri CLI missing: run `pnpm --dir gui install` first")
    subprocess.run([pnpm, "--dir", str(ROOT / "gui"), "tauri", "icon", str(src), "-o", str(out)],
                   check=True, capture_output=True)


def sort_icns(path: pathlib.Path) -> None:
    """Rewrite an .icns with its entries in a fixed order.

    The Tauri CLI writes the same entries in a different order on every run,
    so the file would change on every re-render. An .icns is the magic
    `icns`, the total length, then entries of a 4-byte type, a 4-byte
    big-endian length (header included) and the data."""
    data = path.read_bytes()
    assert data[:4] == b"icns" and int.from_bytes(data[4:8], "big") == len(data)
    entries, at = [], 8
    while at < len(data):
        size = int.from_bytes(data[at + 4 : at + 8], "big")
        entries.append(data[at : at + size])
        at += size
    path.write_bytes(data[:8] + b"".join(sorted(entries, key=lambda e: e[:4])))


def main() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        rounded, macos, square = work / "rounded", work / "macos", work / "square"
        tauri_icon(MASTER / "app-icon-rounded.svg", rounded)
        tauri_icon(MASTER / "app-icon-macos.svg", macos)
        tauri_icon(MASTER / "galley-icon.svg", square)

        for name in ROUNDED:
            shutil.copyfile(rounded / name, ICONS / name)
        for name in MACOS:
            shutil.copyfile(macos / name, ICONS / name)
        sort_icns(ICONS / "icon.icns")
        for name in SQUARE_DIRS:
            shutil.rmtree(ICONS / name, ignore_errors=True)
            shutil.copytree(square / name, ICONS / name)
        shutil.copyfile(rounded / "128x128@2x.png", ROOT / "docs/assets/galley-icon.png")

    shutil.copyfile(MASTER / "galley-icon.svg", ROOT / "gui/src/assets/galley-icon.svg")
    for path in [*(ICONS / n for n in ROUNDED + MACOS + SQUARE_DIRS),
                 ROOT / "docs/assets/galley-icon.png", ROOT / "gui/src/assets/galley-icon.svg"]:
        print(f"wrote {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
