"""Column schema for the Shipping Bill workbook template.

Single source of truth for column order, shared by generate_template.py (which
builds templates/Book3.xlsx) and excel_writer.py (which appends rows to a
copy of it). Column *order* is what maps parsed fields to worksheet columns —
not header text — so a custom uploaded template must keep this same order.

Column 24 is an intentional blank spacer between the Drawback (PART IV-A) and
RODTEP (PART IV-M) column groups, matching the visual separation in the real
annexure between those two claim tables.
"""

from __future__ import annotations

# (field header text, LineRecord attribute name) — None attribute = spacer column.
COLUMN_SPEC: list[tuple[str, str | None]] = [
    ("Port Code", "port_code"),
    ("Shipping Bill No", "shipping_bill_no"),
    ("Shipping Bill Date", "shipping_bill_date"),
    ("Invoice No", "invoice_no"),
    ("Invoice Date", "invoice_date"),
    ("Exchange Rate", "exchange_rate"),
    ("Item No", "item_no"),
    ("HSN Code", "hsn_code"),
    ("Product Description", "product_description"),
    ("Quantity", "quantity"),
    ("UQC", "uqc"),
    ("Unit Rate", "unit_rate"),
    ("Item Value (FCY)", "item_value_fcy"),
    ("1.INV SNO", "dbk_inv_sno"),
    ("2.ITEM SNO", "dbk_item_sno"),
    ("3.DBK SNO.", "dbk_sno"),
    ("4.QTY/WT", "dbk_qty_wt"),
    ("5.VALUE", "dbk_value"),
    ("6.RATE", "dbk_rate"),
    ("7.DBK AMT", "dbk_amt"),
    ("8.STALEV", "dbk_stalev"),
    ("9.CENLEV", "dbk_cenlev"),
    ("10.ROSCTL AMT", "dbk_rosctl_amt"),
    ("", None),
    ("1.INVSN", "rodtep_invsn"),
    ("2.ITMSN", "rodtep_itmsn"),
    ("3. QUANTITY", "rodtep_quantity"),
    ("4. UQC", "rodtep_uqc"),
    ("5. NO. OF UNITS", "rodtep_no_of_units"),
    ("6. VALUE", "rodtep_value"),
]

COLUMNS = [header for header, _ in COLUMN_SPEC]
ATTRS = [attr for _, attr in COLUMN_SPEC]
NUM_COLUMNS = len(COLUMN_SPEC)

# Part/section grouping for the merged header rows — (start_col, end_col, text), 1-indexed inclusive.
PART_HEADER_ROW: list[tuple[int, int, str]] = [
    (1, 3, "PART I - SHIPPING BILL SUMMARY"),
    (4, 13, "PART II - INVOICE DETAILS"),
    (14, 23, "PART IV - EXPORT SCHEME DETAILS"),
    (25, 30, "PART IV - EXPORT SCHEME DETAILS"),
]
SECTION_HEADER_ROW: list[tuple[int, int, str]] = [
    (4, 5, "A. REF"),
    (6, 6, "C. VAL DTLS"),
    (7, 13, "D. ITEM DETAILS"),
    (14, 23, "A. DRAWBACK & ROSL CLAIM"),
    (25, 30, "M. RODTEP DETAILS"),
]

HEADER_ROWS = 3
FIRST_DATA_ROW = HEADER_ROWS + 1

# Attributes written as real numbers (not text) so Excel right-aligns them
# and the workbook's own number semantics (sorting, SUM formulas) work.
NUMERIC_ATTRS = {
    "exchange_rate", "quantity", "unit_rate", "item_value_fcy",
    "dbk_qty_wt", "dbk_value", "dbk_rate", "dbk_amt", "dbk_stalev", "dbk_cenlev", "dbk_rosctl_amt",
    "rodtep_quantity", "rodtep_no_of_units", "rodtep_value",
}

# 1-indexed column numbers, de-duplicated per (shipping bill, invoice, item).
PORT_CODE_COL = 1
SHIPPING_BILL_COL = 2
INVOICE_COL = 4
ITEM_COL = 7
