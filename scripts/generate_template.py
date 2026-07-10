#!/usr/bin/env python3
"""One-time (re)generation script for templates/Book3.xlsx, the built-in
default workbook. Not part of the request-time pipeline — run this manually
whenever the column schema in excel_writer.py changes.

Usage:
    python3 scripts/generate_template.py
"""

from __future__ import annotations

import os

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter

from excel_writer import COLUMNS

OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "..", "templates", "Book3.xlsx")

COLUMN_WIDTHS = {
    "Description": 32,
    "Shipping Bill Date": 16,
    "Invoice Date": 16,
    "Source File": 24,
}
DEFAULT_WIDTH = 14


def main() -> None:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Sheet1"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="1F2937", end_color="1F2937", fill_type="solid")

    for col_index, header in enumerate(COLUMNS, start=1):
        cell = sheet.cell(row=1, column=col_index, value=header)
        cell.font = header_font
        cell.fill = header_fill
        sheet.column_dimensions[get_column_letter(col_index)].width = COLUMN_WIDTHS.get(header, DEFAULT_WIDTH)

    sheet.freeze_panes = "A2"

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)
    workbook.save(OUTPUT_PATH)
    print(f"Wrote {os.path.abspath(OUTPUT_PATH)}")


if __name__ == "__main__":
    main()
