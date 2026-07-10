"""ExcelWriter: load a template workbook, append new rows, save a copy.

Knows nothing about PDF parsing — it only ever sees plain row values and a
de-duplication key string. Loads the template with openpyxl (which
preserves existing formatting, merged cells, formulas, fonts, borders, and
column widths as long as we only ever write to previously-untouched cells)
and writes to a *new* output path; the template itself is never modified.

Performance: the workbook is loaded once, the existing-row HashSet is built
once by a single top-to-bottom scan, and the workbook is saved once after
every row has been appended in memory — matching the "load once, save once,
never rescan" requirement for batches of thousands of PDFs.
"""

from __future__ import annotations

from datetime import date, datetime, time

from openpyxl import load_workbook

# Column order written to the sheet. Custom templates must use this same
# header order (see README) — the writer maps by fixed column *index*, not
# by reading header text, to keep this simple and dependency-free.
COLUMNS = [
    "Shipping Bill No",
    "Shipping Bill Date",
    "Invoice No",
    "Invoice Date",
    "Item No",
    "HS Code",
    "Description",
    "Quantity",
    "UQC",
    "Rate",
    "FOB",
    "Invoice Value",
    "Drawback",
    "RODTEP",
    "Exchange Rate",
    "IEC",
    "GSTIN",
    "Port Code",
    "Source File",
]

HEADER_ROW = 1
SHIPPING_BILL_COL = COLUMNS.index("Shipping Bill No") + 1
INVOICE_COL = COLUMNS.index("Invoice No") + 1
ITEM_COL = COLUMNS.index("Item No") + 1


class ExcelWriter:
    def __init__(self, template_path: str):
        self._workbook = load_workbook(template_path)
        self._sheet = self._workbook.active
        self._seen_keys: set[str] = set()
        self._new_rows: set[int] = set()
        self._next_row = self._scan_existing_rows()

    def _scan_existing_rows(self) -> int:
        """Single pass over existing data rows: builds the de-duplication
        HashSet and finds the true last data row (ignoring trailing
        formatted-but-empty rows some templates ship with)."""
        last_data_row = HEADER_ROW

        for row in range(HEADER_ROW + 1, self._sheet.max_row + 1):
            sb = self._sheet.cell(row=row, column=SHIPPING_BILL_COL).value
            invoice = self._sheet.cell(row=row, column=INVOICE_COL).value
            item = self._sheet.cell(row=row, column=ITEM_COL).value

            if sb is None and invoice is None and item is None:
                continue

            last_data_row = row
            self._seen_keys.add(f"{sb}|{invoice}|{item}")

        return last_data_row + 1

    def has_key(self, key: str) -> bool:
        return key in self._seen_keys

    def append_row(self, key: str, values: list) -> None:
        """Appends one row. Caller must have already checked has_key(key)."""
        for col, value in enumerate(values, start=1):
            self._sheet.cell(row=self._next_row, column=col, value=value)
        self._seen_keys.add(key)
        self._new_rows.add(self._next_row)
        self._next_row += 1

    def save(self, output_path: str) -> None:
        self._workbook.save(output_path)

    def to_preview(self) -> dict:
        """Converts every data row currently in the worksheet (pre-existing
        and newly-appended alike) into plain JSON — read from the in-memory
        workbook we already have open, never by re-reading the saved file.
        Call only after save(); the row range is fixed at that point."""
        rows = []
        for row_num in range(HEADER_ROW + 1, self._next_row):
            values = [
                _serialize_cell(self._sheet.cell(row=row_num, column=col).value)
                for col in range(1, len(COLUMNS) + 1)
            ]
            rows.append({
                "rowNumber": row_num,
                "values": values,
                "isNew": row_num in self._new_rows,
            })
        return {"columns": list(COLUMNS), "rows": rows}


def _serialize_cell(value):
    """openpyxl can hand back real datetime/date/time objects for cells
    that already held Excel date types (e.g. in a pre-existing custom
    template) — json.dumps can't serialize those directly."""
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    return value
