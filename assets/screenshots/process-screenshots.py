#!/usr/bin/env python3
"""Redact sensitive bits and round corners for marketing screenshots.

Always restores from _originals/ first so the script is idempotent.
"""
from __future__ import annotations

import shutil
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
BACKUP = ROOT / "_originals"

# macOS cluster cards — account-id band + local username in kubeconfig path
MAC_ARN_X = (508, 592)
MAC_ARN_YS = (148, 294)
MAC_USER_X = (392, 430)
MAC_PATH_ROWS = [166, 315, 440]

# Windows cluster card — account id + :user/… on ARN subtitle (prod card)
WIN_ARN_BOX = (455, 289, 640, 298)

# Ubuntu cluster card — account id on prod ARN subtitle (keep GNOME window alpha)
UBUNTU_ARN_BOX = (328, 270, 478, 283)

CORNER_RADIUS_MAC = 15  # matches real macOS window curve in the shots
# iPad screenshots include device chrome; screen/hardware curve ≈ 58px at 1224×935
CORNER_RADIUS_IPAD = 58

MAC_SHOTS = [
    "01-mac-overview.png",
    "02-mac-pods.png",
    "02-mac-pods-info.png",
    "03-mac-logs.png",
    "04-mac-clusters.png",
    "04-mac-clusters-2.png",
]
MAC_AI_SHOTS = [
    "05-mac-ai-picker.png",
    "05-mac-ai-chat.png",
    "05-mac-ai-approve.png",
    "05-mac-ai-tabs.png",
    "05-mac-ai-settings.png",
]
WIN_SHOTS = [
    "01-win-overview.png",
    "02-win-pods.png",
    "02-win-pods-info.png",
    "03-win-logs.png",
    "04-win-clusters.png",
]
IPAD_SHOTS = [
    "01-ipad-overview.png",
    "01-ipad-overview-light.png",
    "02-ipad-pods.png",
    "02-ipad-pods-light.png",
    "02-ipad-pods-info.png",
    "03-ipad-logs.png",
    "04-ipad-clusters.png",
]
UBUNTU_SHOTS = [
    "01-ubuntu-overview.png",
    "02-ubuntu-pods.png",
    "02-ubuntu-pods-info.png",
    "03-ubuntu-logs.png",
    "04-ubuntu-clusters.png",
]

ALL_SHOTS = MAC_SHOTS + MAC_AI_SHOTS + WIN_SHOTS + IPAD_SHOTS + UBUNTU_SHOTS

# Match existing mac marketing width (~1978) so AI shots don't dwarf the gallery.
MAC_TARGET_WIDTH = 1978


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
    draw.rounded_rectangle(box, radius=3, fill=fill)


def redact_mac_clusters(path: Path) -> None:
    im = Image.open(path).convert("RGB")
    for y in MAC_ARN_YS:
        fill = sample_fill_color(im, 620, y)
        redact_box(im, (MAC_ARN_X[0], y - 8, MAC_ARN_X[1], y + 10), fill)
    for y in MAC_PATH_ROWS:
        fill = sample_fill_color(im, 560, y)
        redact_box(im, (MAC_USER_X[0], y - 8, MAC_USER_X[1], y + 10), fill)
    im.save(path, optimize=True)


def redact_win_clusters(path: Path) -> None:
    im = Image.open(path).convert("RGB")
    x0, y0, x1, y1 = WIN_ARN_BOX
    fill = sample_fill_color(im, x1 + 12, (y0 + y1) // 2)
    redact_box(im, WIN_ARN_BOX, fill)
    im.save(path, optimize=True)


def redact_ubuntu_clusters(path: Path) -> None:
    """Redact ARN account id without flattening GNOME window alpha."""
    im = Image.open(path).convert("RGBA")
    alpha = im.getchannel("A")
    rgb = im.convert("RGB")
    x0, y0, x1, y1 = UBUNTU_ARN_BOX
    fill = sample_fill_color(rgb, x1 + 12, (y0 + y1) // 2)
    redact_box(rgb, UBUNTU_ARN_BOX, fill)
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    out.save(path, optimize=True)


def round_corners(path: Path, radius: int, *, supersample: int = 2) -> None:
    """Apply rounded alpha mask. Supersample for smoother AA on large iPad radii."""
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    s = max(1, supersample)
    mask = Image.new("L", (w * s, h * s), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w * s - 1, h * s - 1), radius=radius * s, fill=255)
    if s > 1:
        mask = mask.resize((w, h), Image.Resampling.LANCZOS)
    im.putalpha(mask)
    im.save(path, optimize=True)


def scale_to_width(path: Path, target_width: int) -> None:
    im = Image.open(path)
    w, h = im.size
    if w <= target_width:
        return
    nh = max(1, round(h * (target_width / w)))
    out = im.resize((target_width, nh), Image.Resampling.LANCZOS)
    out.save(path, optimize=True)


def main() -> None:
    BACKUP.mkdir(exist_ok=True)

    for name in ALL_SHOTS:
        src = ROOT / name
        backup = BACKUP / name
        if backup.exists():
            shutil.copy2(backup, src)
        elif src.exists():
            shutil.copy2(src, backup)
        else:
            raise SystemExit(f"missing {name} in {ROOT} and {BACKUP}")

    redact_mac_clusters(ROOT / "04-mac-clusters.png")
    redact_mac_clusters(ROOT / "04-mac-clusters-2.png")
    redact_win_clusters(ROOT / "04-win-clusters.png")
    redact_ubuntu_clusters(ROOT / "04-ubuntu-clusters.png")

    for name in MAC_AI_SHOTS:
        scale_to_width(ROOT / name, MAC_TARGET_WIDTH)

    for name in MAC_SHOTS + MAC_AI_SHOTS:
        round_corners(ROOT / name, CORNER_RADIUS_MAC, supersample=3)
    for name in IPAD_SHOTS:
        round_corners(ROOT / name, CORNER_RADIUS_IPAD, supersample=3)
    # Windows: leave square (native window chrome is rectangular)

    print("done mac:", ", ".join(MAC_SHOTS))
    print("done mac AI:", ", ".join(MAC_AI_SHOTS))
    print("done win (redact only):", ", ".join(WIN_SHOTS))
    print("done ipad:", ", ".join(IPAD_SHOTS))
    print("done ubuntu (redact only, keep window alpha):", ", ".join(UBUNTU_SHOTS))


if __name__ == "__main__":
    main()
