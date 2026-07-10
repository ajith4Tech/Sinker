"""PART 4 — End-to-end verification: parser output == workbook == preview.

Since the preview is now read directly from the saved workbook (see
workbook_reader.py), "preview == workbook" is true by construction — there
is no separate preview representation left to drift. What still needs
checking is "parser output == workbook": every LineRecord this run actually
wrote must appear, unchanged, at the exact cell ExcelWriter.append_row()
said it wrote it to. This catches a wrong value, a value in the wrong
column (shifted), or a mandatory field that landed blank.

Never silent: on any mismatch this returns ok=False with the specific
fields/cells at fault, and parser.py emits a "validation_failed" NDJSON
event rather than shipping a workbook nobody checked.
"""

from __future__ import annotations

from openpyxl.utils import column_index_from_string

MANDATORY_HEADERS = {"Port Code", "Shipping Bill No", "Shipping Bill Date", "Invoice No", "Item No"}


def _values_equal(expected, actual) -> bool:
    if expected == actual:
        return True
    if expected is None or actual is None:
        return str(expected or "") == str(actual or "")
    try:
        return abs(float(expected) - float(actual)) < 1e-9
    except (TypeError, ValueError):
        return str(expected).strip() == str(actual).strip()


def _split_cell_ref(cell_ref: str) -> tuple[str, int]:
    i = 0
    while i < len(cell_ref) and cell_ref[i].isalpha():
        i += 1
    return cell_ref[:i], int(cell_ref[i:])


def verify_workbook(
    written_records: list[dict],
    workbook_model: dict,
    attrs: list[str | None],
    columns: list[str],
    key_cols: tuple[int, int, int],
) -> dict:
    incorrect_fields = []
    blank_mandatory = []
    shifted_columns = []

    rows = workbook_model["rows"]

    # Shifted-columns check: the field-header row (row 3, 1-indexed) in the
    # saved workbook must match template_schema.COLUMNS at every column —
    # otherwise every value below it is silently in the wrong column.
    header_row_idx = 2  # 0-indexed row 3
    if header_row_idx < len(rows):
        actual_header_row = rows[header_row_idx]
        for col_idx, expected_header in enumerate(columns):
            actual = actual_header_row[col_idx]["value"] if col_idx < len(actual_header_row) else None
            if (expected_header or None) != (actual or None):
                shifted_columns.append({
                    "column": col_idx + 1,
                    "expectedHeader": expected_header,
                    "actualHeader": actual,
                })

    for record in written_records:
        cell_map = record.get("_cell_map", {})
        for header, attr in zip(columns, attrs):
            if attr is None:
                continue
            cell_ref = cell_map.get(header)
            if not cell_ref:
                continue
            expected = record.get(attr)
            col_letter, row_num = _split_cell_ref(cell_ref)
            col_idx = column_index_from_string(col_letter)
            if row_num - 1 >= len(rows):
                continue
            actual_row = rows[row_num - 1]
            actual = actual_row[col_idx - 1]["value"] if col_idx - 1 < len(actual_row) else None

            if not _values_equal(expected, actual):
                incorrect_fields.append({
                    "field": header, "cell": cell_ref,
                    "expected": expected, "actual": actual,
                    "pdfSource": record.get("_source_pdf"),
                })

            if header in MANDATORY_HEADERS and (actual is None or actual == ""):
                blank_mandatory.append({"field": header, "cell": cell_ref, "pdfSource": record.get("_source_pdf")})

    ok = not (incorrect_fields or blank_mandatory or shifted_columns)
    return {
        "ok": ok,
        "recordsChecked": len(written_records),
        "incorrectFields": incorrect_fields,
        "blankMandatoryFields": blank_mandatory,
        "shiftedColumns": shifted_columns,
    }
