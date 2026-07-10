"""Regex label patterns for Shipping Bill field extraction.

Kept separate from ShippingBillParser's control flow: this module only maps
a field name to the label variants it might appear under in the PDF's text.
Widen these lists (not the parsing strategy in shipping_bill_parser.py) once
real sample PDFs are available — wording/spacing varies between customs
brokers and ports.
"""

# Tolerant of ":" / "." / extra whitespace between a label and its value —
# customs document generators are inconsistent about this.
_VALUE = r"[:\-]?\s*([A-Za-z0-9./,\-\s]+?)"
_END = r"(?=\n|\s{2,}|$)"

# Fields that appear once per document (outside the line-item table).
HEADER_PATTERNS: dict[str, list[str]] = {
    "shipping_bill": [
        rf"S\.?B\.?\s*No\.?{_VALUE}{_END}",
        rf"Shipping\s*Bill\s*No\.?{_VALUE}{_END}",
    ],
    "shipping_bill_date": [
        rf"S\.?B\.?\s*Date{_VALUE}{_END}",
        rf"Shipping\s*Bill\s*Date{_VALUE}{_END}",
    ],
    "invoice_number": [
        rf"Invoice\s*No\.?{_VALUE}{_END}",
    ],
    "invoice_date": [
        rf"Invoice\s*Date{_VALUE}{_END}",
    ],
    "iec": [
        rf"IEC(?:\s*Code)?{_VALUE}{_END}",
    ],
    "gstin": [
        rf"GSTIN{_VALUE}{_END}",
    ],
    "port_code": [
        rf"Port\s*Code{_VALUE}{_END}",
        rf"Port\s*of\s*Loading{_VALUE}{_END}",
    ],
    "exchange_rate": [
        rf"Exchange\s*Rate{_VALUE}{_END}",
    ],
}

# Fields that repeat once per line item in the goods table.
ITEM_PATTERNS: dict[str, list[str]] = {
    "item_number": [
        rf"Item\s*No\.?{_VALUE}{_END}",
        rf"Sl\.?\s*No\.?{_VALUE}{_END}",
    ],
    "hs_code": [
        rf"HS\s*Code{_VALUE}{_END}",
        rf"H\.?S\.?N\.?\s*Code{_VALUE}{_END}",
    ],
    "description": [
        rf"Description(?:\s*of\s*Goods)?{_VALUE}{_END}",
    ],
    "quantity": [
        rf"Quantity{_VALUE}{_END}",
    ],
    "uqc": [
        rf"UQC{_VALUE}{_END}",
    ],
    "rate": [
        rf"Rate{_VALUE}{_END}",
    ],
    "fob": [
        rf"FOB(?:\s*Value)?{_VALUE}{_END}",
    ],
    "invoice_value": [
        rf"Invoice\s*Value{_VALUE}{_END}",
    ],
    "drawback": [
        rf"Drawback(?:\s*Amount)?{_VALUE}{_END}",
    ],
    "rodtep": [
        rf"RODTEP(?:\s*Amount)?{_VALUE}{_END}",
    ],
}

# Line items are table rows, each introduced by its own "Item No" / "Sl No".
# Splitting the document on this boundary isolates one item's fields from
# the next (and from header fields, which live before the first boundary).
ITEM_BOUNDARY_PATTERN = r"(?=Item\s*No\.?[:\-\s]|Sl\.?\s*No\.?[:\-\s])"
