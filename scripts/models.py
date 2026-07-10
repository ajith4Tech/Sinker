"""Shared data contract between ShippingBillParser and ExcelWriter.

Mirrors the real ICEGATE Shipping Bill annexure structure: PART I (bill
header), PART II/III (one Invoice per S.No, each with one or more line
Items), and PART IV's Drawback (A) and RODTEP (M) claim tables, which are
keyed back to a line item via (Invoice SNo, Item SNo).

Neither ShippingBillParser nor ExcelWriter imports the other — both depend
only on this module.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Optional


@dataclass
class ExtractionLogEntry:
    """One row of the --debug trace / validation audit: what label pattern
    was tried, what text (if any) it matched, what value was extracted, and
    — critically — *why* it failed when it did. Never silently blank."""

    field: str
    label_pattern: str
    matched_text: Optional[str] = None
    extracted_value: Optional[str] = None
    status: str = "ok"  # "ok" | "not_found" | "empty"
    reason: Optional[str] = None
    context: Optional[str] = None
    workbook_cell: Optional[str] = None
    # Deterministic join key ("header" / "invoice:<sno>" / "item:<inv sno>:
    # <item sno>" / "drawback:<inv sno>:<item sno>" / "rodtep:<invsn>:
    # <itmsn>") identifying which record this entry was extracted from — lets
    # the orchestrator attribute a workbook cell back to the exact row this
    # value ended up in once LineRecords are joined and written. Must be a
    # plain string (not e.g. Python id()) since results cross a process-pool
    # JSON boundary before LineRecords are built. Internal bookkeeping only;
    # not meant to be exposed to the frontend.
    source_key: Optional[str] = None


@dataclass
class InvoiceItem:
    item_sno: Optional[str] = None
    hs_code: Optional[str] = None
    description: Optional[str] = None
    quantity: Optional[str] = None
    uqc: Optional[str] = None
    unit_rate: Optional[str] = None
    item_value_fcy: Optional[str] = None


@dataclass
class Invoice:
    sno: Optional[str] = None
    invoice_no: Optional[str] = None
    invoice_date: Optional[str] = None
    exchange_rate: Optional[str] = None
    items: list[InvoiceItem] = field(default_factory=list)


@dataclass
class DrawbackRow:
    """PART IV-A: Drawback & ROSL Claim."""

    inv_sno: Optional[str] = None
    item_sno: Optional[str] = None
    dbk_sno: Optional[str] = None
    qty_wt: Optional[str] = None
    value: Optional[str] = None
    rate: Optional[str] = None
    dbk_amt: Optional[str] = None
    stalev: Optional[str] = None
    cenlev: Optional[str] = None
    rosctl_amt: Optional[str] = None


@dataclass
class RodtepRow:
    """PART IV-M: RODTEP Details."""

    invsn: Optional[str] = None
    itmsn: Optional[str] = None
    quantity: Optional[str] = None
    uqc: Optional[str] = None
    no_of_units: Optional[str] = None
    value: Optional[str] = None


@dataclass
class ShippingBillResult:
    port_code: Optional[str] = None
    shipping_bill_no: Optional[str] = None
    shipping_bill_date: Optional[str] = None
    invoices: list[Invoice] = field(default_factory=list)
    drawback_rows: list[DrawbackRow] = field(default_factory=list)
    rodtep_rows: list[RodtepRow] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    debug_log: list[ExtractionLogEntry] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class LineRecord:
    """One flattened output row: an Invoice+InvoiceItem pair, joined to its
    matching DrawbackRow and RodtepRow (matched by Invoice SNo + Item SNo).
    This is exactly one row of the destination worksheet."""

    port_code: Optional[str]
    shipping_bill_no: Optional[str]
    shipping_bill_date: Optional[str]
    invoice_no: Optional[str]
    invoice_date: Optional[str]
    exchange_rate: Optional[str]
    item_no: Optional[str]
    hsn_code: Optional[str]
    product_description: Optional[str]
    quantity: Optional[str]
    uqc: Optional[str]
    unit_rate: Optional[str]
    item_value_fcy: Optional[str]
    dbk_inv_sno: Optional[str]
    dbk_item_sno: Optional[str]
    dbk_sno: Optional[str]
    dbk_qty_wt: Optional[str]
    dbk_value: Optional[str]
    dbk_rate: Optional[str]
    dbk_amt: Optional[str]
    dbk_stalev: Optional[str]
    dbk_cenlev: Optional[str]
    dbk_rosctl_amt: Optional[str]
    rodtep_invsn: Optional[str]
    rodtep_itmsn: Optional[str]
    rodtep_quantity: Optional[str]
    rodtep_uqc: Optional[str]
    rodtep_no_of_units: Optional[str]
    rodtep_value: Optional[str]

    def to_dict(self) -> dict:
        return asdict(self)
