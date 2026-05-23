#!/usr/bin/env python3
"""Generate NSIS installer BMPs from public/nova-logo.png (stdlib + optional Pillow)."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC_HEADER = ROOT / "public" / "nova-logo.png"
SRC_SIDEBAR = ROOT / "packaging" / "branding" / "NovaLogo.png"
OUT_DIR = ROOT / "packaging" / "windows"


def write_bmp(path: Path, width: int, height: int, rgb_rows: list[bytes]) -> None:
    """Write 24-bit BMP (bottom-up rows). Each row: width * 3 bytes, padded to 4."""
    row_stride = ((width * 3 + 3) // 4) * 4
    pixel_data = b"".join(
        row.ljust(row_stride, b"\x00") for row in reversed(rgb_rows)
    )
    file_size = 54 + len(pixel_data)
    dib = struct.pack(
        "<IIIHHIIIIII",
        40,
        width,
        height,
        1,
        24,
        0,
        len(pixel_data),
        0,
        0,
        0,
        0,
    )
    header = struct.pack("<2sIhhI", b"BM", file_size, 0, 0, 54) + dib
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(header + pixel_data)


def solid_rows(w: int, h: int, rgb: tuple[int, int, int]) -> list[bytes]:
    row = bytes(rgb) * w
    return [row] * h


def from_pillow(src: Path, w: int, h: int) -> list[bytes]:
    from PIL import Image

    img = Image.open(src).convert("RGB")
    img = img.resize((w, h), Image.Resampling.LANCZOS)
    rows: list[bytes] = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            r, g, b = img.getpixel((x, y))
            row.extend((b, g, r))
        rows.append(bytes(row))
    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    bg = (15, 23, 42)  # slate-950

    try:
        if not SRC_HEADER.is_file():
            raise FileNotFoundError(SRC_HEADER)
        header_rows = from_pillow(SRC_HEADER, 150, 57)
        if SRC_SIDEBAR.is_file():
            sidebar_rows = from_pillow(SRC_SIDEBAR, 164, 314)
        else:
            sidebar_rows = from_pillow(SRC_HEADER, 164, 314)
    except Exception as e:
        print(f"nova-branding: {e} — using solid placeholder", file=sys.stderr)
        header_rows = solid_rows(150, 57, bg)
        sidebar_rows = solid_rows(164, 314, bg)

    write_bmp(OUT_DIR / "nsis-header.bmp", 150, 57, header_rows)
    write_bmp(OUT_DIR / "nsis-sidebar.bmp", 164, 314, sidebar_rows)
    print(f"Wrote {OUT_DIR / 'nsis-header.bmp'} and nsis-sidebar.bmp")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
