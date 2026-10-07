#!/usr/bin/env python3
"""Render the README banner (light / dark) and the GitHub social preview.

Companion to docs/devlog/2026-10-07-readme-visual-pass.md. The images are
typographic on purpose (wordmark, slogan, app icon; no UI), so they only need
re-rendering when the slogan, the icon or the brand palette changes.

    scripts/render-readme-assets.py              # writes into docs/assets/
    CHROME=/path/to/chrome scripts/render-readme-assets.py

Outputs:

  - docs/assets/readme-banner.png       800 x 320 CSS px @2x, transparent
  - docs/assets/readme-banner-dark.png  same, dark-mode inks
  - docs/assets/social-preview.png      1280 x 640, upload by hand in the
                                        repo's Settings -> Social preview

Needs the GUI's fonts (`pnpm --dir gui install` provides @fontsource) and a
headless Chrome: $CHROME, else Playwright's cached headless shell, else
Google Chrome.app. Colors mirror gui/src/styles/globals.css (--color-ink,
--color-ink-soft, --color-ink-muted, --color-brand*, --color-app).
"""

from __future__ import annotations

import glob
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "docs/assets"
FONTS = ROOT / "gui/node_modules/@fontsource"
ICON = ASSETS / "galley-icon.png"

# Light / dark inks from gui/src/styles/globals.css.
THEMES = {
    "light": {"ink": "#211f1c", "soft": "#57534c", "rule": "#c68762"},
    "dark": {"ink": "#ede7e0", "soft": "#c6bdb2", "rule": "#d6a083"},
}


def find_chrome() -> list[str]:
    if os.environ.get("CHROME"):
        return [os.environ["CHROME"], "--headless"]
    shells = sorted(glob.glob(os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-*/"
        "chrome-headless-shell-*/chrome-headless-shell")))
    if shells:
        return [shells[-1], "--headless"]
    app = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    if os.path.exists(app):
        return [app, "--headless=new"]
    if shutil.which("google-chrome"):
        return ["google-chrome", "--headless=new"]
    sys.exit("No headless Chrome found; set CHROME=/path/to/chrome")


def font_faces() -> str:
    files = FONTS / "newsreader/files"
    inter = FONTS / "inter/files/inter-latin-400-normal.woff2"
    need = [files / "newsreader-latin-500-italic.woff2",
            files / "newsreader-latin-400-normal.woff2", inter]
    missing = [str(p) for p in need if not p.exists()]
    if missing:
        sys.exit("Missing fonts (run `pnpm --dir gui install`): " + ", ".join(missing))
    return (
        f"@font-face{{font-family:NR;font-style:italic;font-weight:500;src:url({need[0].as_uri()})}}"
        f"@font-face{{font-family:NR;font-style:normal;font-weight:400;src:url({need[1].as_uri()})}}"
        f"@font-face{{font-family:IN;font-weight:400;src:url({need[2].as_uri()})}}"
    )


def banner_html(theme: dict[str, str]) -> str:
    return f"""<div style="box-sizing:border-box;width:798px;height:320px;display:flex;flex-direction:column;align-items:center;justify-content:center">
<img src="{ICON.as_uri()}" style="width:76px;height:76px;margin-bottom:20px">
<div style="font:italic 500 92px/1 NR;letter-spacing:.005em;color:{theme['ink']}">Galley</div>
<div style="width:36px;height:1.5px;background:{theme['rule']};margin:22px 0 18px"></div>
<div style="font:400 28px/1 NR;letter-spacing:.01em;color:{theme['soft']}">Less harness. More model.</div></div>"""


def social_html() -> str:
    return f"""<div style="box-sizing:border-box;width:1280px;height:640px;background:#faf9f8;display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative">
<div style="display:flex;align-items:center;gap:40px">
<img src="{ICON.as_uri()}" style="width:168px;height:168px">
<div style="display:flex;flex-direction:column">
<div style="font:italic 500 150px/1 NR;letter-spacing:.005em;color:#211f1c">Galley</div>
<div style="font:400 40px/1 NR;letter-spacing:.01em;color:#57534c;margin-top:18px;padding-left:6px">Less harness. More model.</div>
</div></div>
<div style="margin-top:64px;font:400 26px/1.4 IN,'PingFang SC','Microsoft YaHei',sans-serif;color:#87827a;text-align:center">A lightweight local AI assistant&nbsp;&nbsp;·&nbsp;&nbsp;极简 harness 的本地全能 AI 助手</div>
<div style="position:absolute;left:0;right:0;bottom:0;height:10px;background:#d9a78a"></div></div>"""


def render(chrome: list[str], body: str, out: pathlib.Path, width: int, height: int,
           scale: int, transparent: bool, workdir: pathlib.Path) -> None:
    page = workdir / (out.stem + ".html")
    page.write_text(
        "<!doctype html><html><head><meta charset=utf-8><style>"
        f"{font_faces()} html,body{{margin:0;background:transparent}}</style></head>"
        f"<body>{body}</body></html>")
    args = chrome + [f"--screenshot={out}", f"--window-size={width},{height}",
                     "--hide-scrollbars", f"--force-device-scale-factor={scale}",
                     "--allow-file-access-from-files", "--virtual-time-budget=3000"]
    if transparent:
        args.append("--default-background-color=00000000")
    subprocess.run(args + [page.as_uri()], check=True, capture_output=True)
    print(f"wrote {out.relative_to(ROOT)}")


def main() -> None:
    chrome = find_chrome()
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        render(chrome, banner_html(THEMES["light"]), ASSETS / "readme-banner.png",
               800, 320, 2, True, work)
        render(chrome, banner_html(THEMES["dark"]), ASSETS / "readme-banner-dark.png",
               800, 320, 2, True, work)
        render(chrome, social_html(), ASSETS / "social-preview.png",
               1280, 640, 1, False, work)


if __name__ == "__main__":
    main()
