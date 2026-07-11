#!/usr/bin/env python3
"""Standalone CLI wrapper around workbook_reader.read_workbook, for the
persistent Excel Preview endpoint (GET /api/workbook-preview).

Lets the preview be read straight off data/workbook.xlsx independently of
running an extraction, so it survives a browser refresh or a server
restart. Read-only; does not import or touch parser.py.

Usage:
    python3 read_workbook_cli.py <path-to-xlsx>
"""

from __future__ import annotations

import json
import sys

from workbook_reader import read_workbook


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(json.dumps({"error": "usage: read_workbook_cli.py <path-to-xlsx>"}), file=sys.stderr)
        return 1
    print(json.dumps(read_workbook(argv[1])))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
