#!/usr/bin/env python3
"""
Extract and pack embedded WebUI gzip blobs in WebUi.cpp.

Usage:
  python tools/webui_sync.py extract
  python tools/webui_sync.py pack
"""

from __future__ import annotations

import argparse
import gzip
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WEBUI_CPP = ROOT / "WebUi.cpp"
OUT_DIR = ROOT / "webui"

BLOCKS = {
    "APP_HTML_GZ": "app.html",
    "SETUP_HTML_GZ": "setup.html",
    "OTA_HTML_GZ": "ota.html",
}

RAW_BLOCKS = {
    "MODBUS_MAP_HTML": "modbus-map.html",
    "CUSTOM_PROGRAM_HTML": "custom-program.html",
}


def block_regex(symbol: str) -> re.Pattern[str]:
    # Match from array declaration to _LEN declaration.
    return re.compile(
        rf"(const uint8_t {symbol}\[] PROGMEM =\s*\{{)(?P<body>.*?)(\n\}};\s*\nstatic constexpr size_t {symbol}_LEN = sizeof\({symbol}\);)",
        re.S,
    )


def raw_block_regex(symbol: str) -> re.Pattern[str]:
    return re.compile(
        rf"(const char {symbol}\[] PROGMEM = R\"rawliteral\()(?P<body>.*?)(\)rawliteral\";)",
        re.S,
    )


def parse_hex_bytes(body: str) -> bytes:
    nums = re.findall(r"0x([0-9a-fA-F]{1,2})", body)
    return bytes(int(x, 16) for x in nums)


def format_hex_bytes(data: bytes, width: int = 16) -> str:
    lines = []
    for i in range(0, len(data), width):
        chunk = data[i : i + width]
        lines.append("  " + ", ".join(f"0x{b:02x}" for b in chunk) + ",")
    return "\n".join(lines)


def extract() -> None:
    text = WEBUI_CPP.read_text(encoding="utf-8")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    for symbol, filename in BLOCKS.items():
        m = block_regex(symbol).search(text)
        if not m:
            raise SystemExit(f"Block not found: {symbol}")
        compressed = parse_hex_bytes(m.group("body"))
        html = gzip.decompress(compressed).decode("utf-8", errors="replace")
        out = OUT_DIR / filename
        out.write_text(html, encoding="utf-8")
        print(f"extracted {symbol} -> {out} ({len(html)} chars)")

    for symbol, filename in RAW_BLOCKS.items():
        m = raw_block_regex(symbol).search(text)
        if not m:
            raise SystemExit(f"Raw block not found: {symbol}")
        html = m.group("body")
        out = OUT_DIR / filename
        out.write_text(html, encoding="utf-8")
        print(f"extracted {symbol} -> {out} ({len(html)} chars)")


def pack() -> None:
    text = WEBUI_CPP.read_text(encoding="utf-8")

    for symbol, filename in BLOCKS.items():
        html_path = OUT_DIR / filename
        if not html_path.exists():
            raise SystemExit(f"Missing source file: {html_path}")
        html = html_path.read_text(encoding="utf-8")
        compressed = gzip.compress(html.encode("utf-8"), compresslevel=9, mtime=0)
        hex_body = "\n" + format_hex_bytes(compressed) + "\n"

        regex = block_regex(symbol)
        m = regex.search(text)
        if not m:
            raise SystemExit(f"Block not found while packing: {symbol}")

        text = text[: m.start()] + m.group(1) + hex_body + m.group(3) + text[m.end() :]
        print(f"packed {symbol} <- {html_path} ({len(compressed)} bytes gzip)")

    for symbol, filename in RAW_BLOCKS.items():
        html_path = OUT_DIR / filename
        if not html_path.exists():
            raise SystemExit(f"Missing source file: {html_path}")
        html = html_path.read_text(encoding="utf-8")
        regex = raw_block_regex(symbol)
        m = regex.search(text)
        if not m:
            raise SystemExit(f"Raw block not found while packing: {symbol}")
        text = text[: m.start()] + m.group(1) + html + m.group(3) + text[m.end() :]
        print(f"packed {symbol} <- {html_path} ({len(html)} chars)")

    WEBUI_CPP.write_text(text, encoding="utf-8")
    print(f"updated {WEBUI_CPP}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["extract", "pack"])
    args = parser.parse_args()

    if args.command == "extract":
        extract()
    else:
        pack()


if __name__ == "__main__":
    main()
