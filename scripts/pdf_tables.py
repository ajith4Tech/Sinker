"""Table-grid extraction helpers for the ICEGATE Shipping Bill PDF layout.

Why this exists: pdfplumber's default page.extract_text() reads left-to-right
top-to-bottom by raw character position, which badly scrambles this
document — it has narrow rotated sidebar labels (e.g. a vertical "DETAILS"
strip) interleaved with dense multi-column tables, so naive text extraction
produces interleaved garbage (verified against real samples).

What works instead: this form is drawn with real ruling lines, so
pdfplumber's find_tables() recovers a clean 2D grid per page. Column *index*
lines up between a label row and the data row(s) beneath it (verified: a row
with blank optional cells still preserves column position — it does not
compact leftward). So every field extractor here follows the same shape:
find the row containing a known label (by regex, tolerant of spacing/case),
then read data from the same column index in a nearby row. This is
label-based/context-based, not hardcoded-coordinate-based: the column index
is discovered per-document from where the label actually landed, never
assumed from a fixed page position.

One artifact to clean up: rotated sidebar text sometimes bleeds a single
stray character + newline into an adjacent cell's value (e.g. "Y\\n1.4" for
what should just be "1.4") because its rotated bounding box overlaps the
cell. clean_cell() strips that specific pattern only — never touches
legitimate multi-line wrapped text (long first line, e.g. wrapped
descriptions).
"""

from __future__ import annotations

import re
from typing import Callable, Optional

Row = list[Optional[str]]

_STRAY_PREFIX = re.compile(r"^[A-Za-z]\n(?=[\d.\-])")


def clean_cell(value: Optional[str]) -> Optional[str]:
    """Strips stray rotated-sidebar-text bleed from a cell value and
    normalizes blank-ish values to None. Never alters legitimate multi-line
    wrapped text (only strips a lone leading letter immediately followed by
    a newline and then a digit/./- — the signature of this specific
    artifact)."""
    if value is None:
        return None
    cleaned = _STRAY_PREFIX.sub("", value).strip()
    return cleaned or None


def get_table_rows(page) -> list[Row]:
    """Returns the page's single ruled-grid table as rows of cleaned cell
    values, or [] if no table is found on this page."""
    tables = page.find_tables()
    if not tables:
        return []
    return [[clean_cell(c) for c in row] for row in tables[0].extract()]


def find_row_index(rows: list[Row], pattern: str, start: int = 0) -> Optional[int]:
    """Returns the index of the first row (at or after `start`) containing a
    cell that matches `pattern` (case-insensitive, search-anywhere)."""
    regex = re.compile(pattern, re.IGNORECASE)
    for i in range(start, len(rows)):
        for cell in rows[i]:
            if cell and regex.search(cell):
                return i
    return None


def find_col_index(row: Row, pattern: str) -> Optional[int]:
    """Returns the column index of the first cell in `row` matching `pattern`."""
    regex = re.compile(pattern, re.IGNORECASE)
    for j, cell in enumerate(row):
        if cell and regex.search(cell):
            return j
    return None


def values_from(row: Optional[Row], col: int, count: int) -> list[Optional[str]]:
    """Reads up to `count` non-blank cell values from `row` at or after
    column `col`, in column order. Used for header mini-tables where the
    label cell and its values don't share a column index (e.g. one merged
    "Port Code SB No SB Date" label cell followed by three separate value
    cells further along the same/next row)."""
    if row is None:
        return [None] * count
    out: list[Optional[str]] = []
    for j in range(col, len(row)):
        if row[j] is not None:
            out.append(row[j])
        if len(out) == count:
            break
    while len(out) < count:
        out.append(None)
    return out


def value_at(rows: list[Row], row_idx: Optional[int], col: Optional[int]) -> Optional[str]:
    """Reads the cell at (row_idx, col), tolerant of either being None or
    out of range."""
    if row_idx is None or col is None or row_idx >= len(rows):
        return None
    row = rows[row_idx]
    if col >= len(row):
        return None
    return row[col]


def iter_section_rows(
    rows: list[Row],
    start: int,
    stop_predicate: Callable[[Row], bool],
) -> list[tuple[int, Row]]:
    """Yields (index, row) for each row after `start` up to (not including)
    the first row matching stop_predicate, or a fully-blank row, or the end
    of the table — the generic "read this section's data rows" loop used by
    every repeating-row section (item tables, drawback table, RODTEP table)."""
    out = []
    for i in range(start, len(rows)):
        row = rows[i]
        if stop_predicate(row):
            break
        if all(c is None for c in row):
            break
        out.append((i, row))
    return out
