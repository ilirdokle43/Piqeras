#!/usr/bin/env python3
"""Generates the PWA / launcher icons.

Written by hand with zlib rather than pulled from an image library so the icons
can be regenerated on any machine with a bare Python install, and so the palette
stays tied to the one in web/src/styles/global.css rather than drifting inside a
binary nobody can diff.

    python tools/make-icons.py
"""

from __future__ import annotations

import math
import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB_ICONS = ROOT / "web" / "public" / "icons"

# Sampled from the sunset in the reference photograph.
SKY_TOP = (27, 36, 48)
SKY_MID = (74, 56, 66)
SKY_LOW = (201, 84, 44)
HORIZON = (255, 150, 80)
SEA_TOP = (46, 82, 102)
SEA_BOTTOM = (11, 13, 16)
SUN = (255, 214, 150)


def lerp(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))  # type: ignore[return-value]


def sky_color(t: float) -> tuple[int, int, int]:
    """t is 0 at the top of the sky, 1 at the horizon."""
    if t < 0.45:
        return lerp(SKY_TOP, SKY_MID, t / 0.45)
    if t < 0.82:
        return lerp(SKY_MID, SKY_LOW, (t - 0.45) / 0.37)
    return lerp(SKY_LOW, HORIZON, (t - 0.82) / 0.18)


def render(size: int) -> bytes:
    horizon = size * 0.62
    sun_cx, sun_cy = size / 2, horizon - size * 0.045
    sun_r = size * 0.155

    rows = bytearray()
    for y in range(size):
        rows.append(0)  # PNG filter type 0 for every scanline
        for x in range(size):
            if y < horizon:
                colour = sky_color(y / horizon)
                # Sun disc, with a soft edge so it does not alias into a cog.
                d = math.hypot(x + 0.5 - sun_cx, y + 0.5 - sun_cy)
                if d < sun_r + 1.5:
                    edge = min(1.0, max(0.0, (sun_r + 0.75 - d) / 1.5))
                    colour = lerp(colour, SUN, edge)
                else:
                    # Glow falling off around the disc.
                    glow = max(0.0, 1.0 - (d - sun_r) / (size * 0.30))
                    colour = lerp(colour, HORIZON, glow * 0.45)
            else:
                t = (y - horizon) / (size - horizon)
                colour = lerp(SEA_TOP, SEA_BOTTOM, t**0.75)
                # The sun's reflection on the water, narrowing with distance.
                width = size * (0.055 + 0.16 * t)
                if abs(x + 0.5 - sun_cx) < width:
                    strength = (1.0 - abs(x + 0.5 - sun_cx) / width) * (1.0 - t) ** 1.6
                    colour = lerp(colour, HORIZON, strength * 0.55)
            rows.extend(colour)
    return bytes(rows)


def write_png(path: Path, size: int) -> None:
    raw = render(size)

    def chunk(tag: bytes, payload: bytes) -> bytes:
        return (
            struct.pack(">I", len(payload))
            + tag
            + payload
            + struct.pack(">I", zlib.crc32(tag + payload) & 0xFFFFFFFF)
        )

    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolour
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)
    print(f"wrote {path.relative_to(ROOT)} ({size}x{size}, {len(png):,} bytes)")


def main() -> None:
    for size in (32, 192, 512):
        write_png(WEB_ICONS / f"icon-{size}.png", size)
    # The maskable icon is the same artwork: the sun sits in the middle 60%, so
    # a circular or squircle mask never clips anything meaningful.
    write_png(WEB_ICONS / "icon-maskable-512.png", 512)


if __name__ == "__main__":
    main()
