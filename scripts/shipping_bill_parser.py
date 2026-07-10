"""ShippingBillParser: PDF text -> ShippingBillResult.

Deterministic, label-based regex extraction only — no AI, no OCR, no ML.
If a label isn't found, the field stays `None`; this class never guesses or
infers a value. It knows nothing about Excel, files, or subprocesses — it is
a pure function of "text in, structured result out" so it can be unit-tested
directly and so a future document type can add its own `*Parser` alongside
it without touching this one.
"""

from __future__ import annotations

import re
from typing import Optional

from models import LineItem, ShippingBillResult
from patterns import HEADER_PATTERNS, ITEM_BOUNDARY_PATTERN, ITEM_PATTERNS


class ShippingBillParser:
    def parse(self, text: str) -> ShippingBillResult:
        result = ShippingBillResult()
        warnings: list[str] = []

        header = self._extract_fields(HEADER_PATTERNS, text)
        result.shipping_bill = header["shipping_bill"]
        result.shipping_bill_date = header["shipping_bill_date"]
        result.invoice_number = header["invoice_number"]
        result.invoice_date = header["invoice_date"]
        result.iec = header["iec"]
        result.gstin = header["gstin"]
        result.port_code = header["port_code"]
        result.exchange_rate = header["exchange_rate"]

        if not result.shipping_bill:
            warnings.append("Shipping Bill Number label not found in document text.")
        if not result.invoice_number:
            warnings.append("Invoice Number label not found in document text.")

        for block in self._split_item_blocks(text):
            values = self._extract_fields(ITEM_PATTERNS, block)
            if any(v is not None for v in values.values()):
                result.items.append(LineItem(**values))

        if not result.items:
            warnings.append("No line items could be extracted from this document.")

        result.warnings = warnings
        return result

    @staticmethod
    def _extract_fields(pattern_map: dict[str, list[str]], text: str) -> dict[str, Optional[str]]:
        return {
            field_name: ShippingBillParser._first_match(patterns, text)
            for field_name, patterns in pattern_map.items()
        }

    @staticmethod
    def _first_match(patterns: list[str], text: str) -> Optional[str]:
        for pattern in patterns:
            m = re.search(pattern, text, re.IGNORECASE)
            if m:
                value = m.group(1).strip()
                if value:
                    return value
        return None

    @staticmethod
    def _split_item_blocks(text: str) -> list[str]:
        """Splits on each item-row boundary (see patterns.ITEM_BOUNDARY_PATTERN).

        Falls back to the whole document when the boundary label appears
        zero or one time (a single-item shipping bill).
        """
        boundary = re.compile(ITEM_BOUNDARY_PATTERN, re.IGNORECASE)
        blocks = [b for b in boundary.split(text) if b.strip()]
        if len(blocks) <= 1:
            return [text]
        # blocks[0] is the preamble before the first item boundary (header
        # section, already handled by _extract_fields(HEADER_PATTERNS, ...))
        # — not itself a line item.
        return blocks[1:]
