#!/usr/bin/env python3
"""Trace a flat bitmap of the Galley icon into the vector master.

The master, core/icons/master/galley-icon.svg, was traced with this script
from the flat bitmap JC picked (main chat PRD ruling 70); every app icon and
the assistant's avatar are rendered from that SVG (see
core/icons/master/README.md). Do not hand-edit its paths. To change the
geometry, have an image model edit the bitmap, then trace it again with this
script; the three colours are plain constants and can be changed in place.

How it traces: scale the bitmap up 4x (bicubic), give every pixel the nearest
of the three palette colours, Gaussian-blur each layer mask to smooth the
pixel steps, and trace two layers with potrace: the silhouette (everything
that is not ground, filled with ink) and the wood on top of it. The ink
outline is what shows between them. The output's viewBox is the scaled-up
size (4096 for a 1024 bitmap), its width and height the bitmap's.

Needs Pillow, numpy and potracer (a pure-Python port of potrace). They are
not in any of the repo's dependency lists; use a throwaway venv:

    python3 -m venv /tmp/trace-venv
    /tmp/trace-venv/bin/pip install pillow numpy potracer
    /tmp/trace-venv/bin/python scripts/trace-galley-icon.py \\
        flat-icon.png core/icons/master/galley-icon.svg

An optional third argument is a JSON object overriding the defaults below,
e.g. '{"blur": 2.5, "alphamax": 1.0}'. The current master is the output of
the defaults (byte for byte) on a 1024 x 1024 RGB bitmap. Tracing takes about
ten seconds.
"""

from __future__ import annotations

import json
import sys

import numpy as np
import potrace
from PIL import Image, ImageFilter

DEFAULTS = {
    "scale": 4,  # upscale factor before tracing
    "blur": 2.0,  # Gaussian radius (upscaled px) that smooths each layer
    "bg": "#fcdba9",  # ground
    "wood": "#f9c071",  # wood
    "ink": "#291a11",  # ink outline
    "turdsize": 200,  # potrace: drop specks smaller than this (px²)
    "alphamax": 1.15,  # potrace: corner threshold
    "opttolerance": 0.6,  # potrace: curve optimisation tolerance
}


def hex_rgb(value: str) -> np.ndarray:
    return np.array([int(value[i : i + 2], 16) for i in (1, 3, 5)], float)


def trace(src: str, out: str, opt: dict) -> int:
    o = {**DEFAULTS, **opt}
    k = o["scale"]
    img = Image.open(src).convert("RGB")
    w0 = img.size[0]
    big = np.asarray(img.resize((w0 * k, w0 * k), Image.BICUBIC)).astype(float)
    palette = np.stack([hex_rgb(o["bg"]), hex_rgb(o["wood"]), hex_rgb(o["ink"])])
    cls = np.argmin(((big[:, :, None, :] - palette[None, None]) ** 2).sum(-1), axis=-1)

    def smooth(mask: np.ndarray) -> np.ndarray:
        m = Image.fromarray((mask * 255).astype(np.uint8)).filter(
            ImageFilter.GaussianBlur(o["blur"]))
        return np.asarray(m) > 127

    def to_path(mask: np.ndarray) -> str:
        curves = potrace.Bitmap(~mask).trace(
            turdsize=o["turdsize"], turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY,
            alphamax=o["alphamax"], opticurve=True, opttolerance=o["opttolerance"])
        d = []
        for c in curves:
            p = c.start_point
            d.append(f"M{p.x:.1f} {p.y:.1f}")
            for s in c.segments:
                d.append(
                    f"L{s.c.x:.1f} {s.c.y:.1f}L{s.end_point.x:.1f} {s.end_point.y:.1f}"
                    if s.is_corner else
                    f"C{s.c1.x:.1f} {s.c1.y:.1f} {s.c2.x:.1f} {s.c2.y:.1f} "
                    f"{s.end_point.x:.1f} {s.end_point.y:.1f}")
            d.append("Z")
        return "".join(d)

    silhouette, wood = smooth(cls != 0), smooth(cls == 1)
    n = w0 * k
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w0}" height="{w0}" viewBox="0 0 {n} {n}">'
           f'<rect width="{n}" height="{n}" fill="{o["bg"]}"/>'
           f'<path d="{to_path(silhouette)}" fill="{o["ink"]}" fill-rule="evenodd"/>'
           f'<path d="{to_path(wood)}" fill="{o["wood"]}" fill-rule="evenodd"/></svg>')
    with open(out, "w") as f:
        f.write(svg)
    return len(svg)


def main() -> None:
    if len(sys.argv) not in (3, 4):
        sys.exit("usage: trace-galley-icon.py SOURCE.png OUT.svg ['{json options}']")
    opt = json.loads(sys.argv[3]) if len(sys.argv) == 4 else {}
    print("bytes", trace(sys.argv[1], sys.argv[2], opt))


if __name__ == "__main__":
    main()
