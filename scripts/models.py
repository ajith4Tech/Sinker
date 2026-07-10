"""Shared data contract between ShippingBillParser and ExcelWriter.

Neither module imports the other — both depend only on this module, so the
parser can be reused by a future document type without knowing anything
about Excel, and the writer never needs to know how a row was extracted.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class LineItem:
    item_number: Optional[str] = None
    hs_code: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[str] = None
    uqc: Optional[str] = None
    rate: Optional[str] = None
    fob: Optional[str] = None
    invoice_value: Optional[str] = None
    drawback: Optional[str] = None
    rodtep: Optional[str] = None


@dataclass
class ShippingBillResult:
    shipping_bill: Optional[str] = None
    shipping_bill_date: Optional[str] = None
    invoice_number: Optional[str] = None
    invoice_date: Optional[str] = None
    iec: Optional[str] = None
    gstin: Optional[str] = None
    port_code: Optional[str] = None
    exchange_rate: Optional[str] = None
    items: list[LineItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)
