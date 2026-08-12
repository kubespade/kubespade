#!/usr/bin/env python3
"""Redact sensitive bits and round corners for marketing screenshots."""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
BACKUP = ROOT / "_originals"

# y bands for ARN account-id lines (both cluster cards)
ARN_Y = (142, 156)
ARN_X = (508, 592)

# /Users/ppuker/.kube/config — hide local username
USER_Y = (162, 176)
USER_X = (392, 430)

PATH_ROWS = [166, 315, 440]

CLUSTER_SHOTS = ["04-mac-clusters.png", "04-mac-clusters-2.png"]
ALL_SHOTS = [
    "01-mac-overview.png",
    "02-mac-pods.png",
    "03-mac-logs.png",
    *CLUSTER_SHOTS,
]

CORNER_RADIUS = 18


def sample_fill_color(im: Image.Image, x: int, y: int) -> tuple[int, int, int]:
    px = im.load()
    w, h = im.size
    samples: list[tuple[int, int, int]] = []
    for dx, dy in ((12, -6), (18, 0), (12, 6), (24, 0)):
        sx, sy = x + dx, y + dy
        if 0 <= sx < w and 0 <= sy < h:
            r, g, b = px[sx, sy][:3]
            samples.append((r, g, b))
    if not samples:
        return (22, 27, 34)
    return (
        sum(c[0] for c in samples) // len(samples),
        sum(c[1] for c in samples) // len(samples),
        sum(c[2] for c in samples) // len(samples),
    )


def redact_box(im: Image.Image, box: tuple[int, int, int, int], fill: tuple[int, int, int]) -> None:
    draw = ImageDraw.Draw(im)
    x0, y0, x1, y1 = box
    draw.rounded_rectangle(box, radius=3, fill=fill)


def redact_cluster_shot(path: Path) -> None:
    im = Image.open(path).convert("RGB")

    for y in (148, 294):
        fill = sample_fill_color(im, 620, y)
        redact_box(im, (ARN_X[0], y - 8, ARN_X[1], y + 10), fill)

    for y in PATH_ROWS:
        fill = sample_fill_color(im, 560, y)
        redact_box(im, (USER_X[0], y - 8, USER_X[1], y + 10), fill)

    im.save(path, optimize=True)


def round_corners(path: Path) -> None:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w - 1, h - 1), radius=CORNER_RADIUS, fill=255)
    im.putalpha(mask)
    im.save(path, optimize=True)


def main() -> None:
    BACKUP.mkdir(exist_ok=True)
    for name in ALL_SHOTS:
        src = ROOT / name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        backup = BACKUP / name
        if not backup.exists():
            shutil.copy2(src, backup)

    for name in CLUSTER_SHOTS:
        redact_cluster_shot(ROOT / name)

    for name in ALL_SHOTS:
        round_corners(ROOT / name)

    print("done:", ", ".join(ALL_SHOTS))


if __name__ == "__main__":
    main()
