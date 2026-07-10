"""Joins a ShippingBillResult's Invoices/Items with its Drawback (PART IV-A)
and RODTEP (PART IV-M) claim rows into flat LineRecords — one per output
worksheet row.

The real annexure links a claim row back to a line item via (Invoice SNo,
Item SNo) — see PART IV's own column headers ("1.INV SNO 2.ITEM SNO" /
"1.INVSN 2.ITMSN"). That's the join key here; it's read directly off the
document, never invented.
"""

from __future__ import annotations

from models import DrawbackRow, Invoice, InvoiceItem, LineRecord, RodtepRow, ShippingBillResult


def build_line_records(result: ShippingBillResult) -> list[tuple[LineRecord, set[str]]]:
    """Returns (LineRecord, source_keys) pairs — source_keys is the set of
    deterministic join keys (see ExtractionLogEntry.source_key) of every
    Invoice/InvoiceItem/DrawbackRow/RodtepRow that contributed to this
    record, used to attribute a workbook cell back to the exact debug_log
    entries once the row has actually been written. Plain strings (not
    Python id()s) so this still works after a result has crossed a
    process-pool JSON boundary."""
    drawback_by_key: dict[tuple, DrawbackRow] = {}
    for d in result.drawback_rows:
        drawback_by_key.setdefault((d.inv_sno, d.item_sno), d)

    rodtep_by_key: dict[tuple, RodtepRow] = {}
    for r in result.rodtep_rows:
        rodtep_by_key.setdefault((r.invsn, r.itmsn), r)

    out: list[tuple[LineRecord, set[int]]] = []

    for invoice in result.invoices:
        items = invoice.items or [InvoiceItem()]
        for item in items:
            key = (invoice.sno, item.item_sno)
            drawback = drawback_by_key.get(key)
            rodtep = rodtep_by_key.get(key)

            record = LineRecord(
                port_code=result.port_code,
                shipping_bill_no=result.shipping_bill_no,
                shipping_bill_date=result.shipping_bill_date,
                invoice_no=invoice.invoice_no,
                invoice_date=invoice.invoice_date,
                exchange_rate=invoice.exchange_rate,
                item_no=item.item_sno,
                hsn_code=item.hs_code,
                product_description=item.description,
                quantity=item.quantity,
                uqc=item.uqc,
                unit_rate=item.unit_rate,
                item_value_fcy=item.item_value_fcy,
                dbk_inv_sno=drawback.inv_sno if drawback else None,
                dbk_item_sno=drawback.item_sno if drawback else None,
                dbk_sno=drawback.dbk_sno if drawback else None,
                dbk_qty_wt=drawback.qty_wt if drawback else None,
                dbk_value=drawback.value if drawback else None,
                dbk_rate=drawback.rate if drawback else None,
                dbk_amt=drawback.dbk_amt if drawback else None,
                dbk_stalev=drawback.stalev if drawback else None,
                dbk_cenlev=drawback.cenlev if drawback else None,
                dbk_rosctl_amt=drawback.rosctl_amt if drawback else None,
                rodtep_invsn=rodtep.invsn if rodtep else None,
                rodtep_itmsn=rodtep.itmsn if rodtep else None,
                rodtep_quantity=rodtep.quantity if rodtep else None,
                rodtep_uqc=rodtep.uqc if rodtep else None,
                rodtep_no_of_units=rodtep.no_of_units if rodtep else None,
                rodtep_value=rodtep.value if rodtep else None,
            )

            source_keys = {"header", f"invoice:{invoice.sno}", f"item:{invoice.sno}:{item.item_sno}"}
            if drawback is not None:
                source_keys.add(f"drawback:{drawback.inv_sno}:{drawback.item_sno}")
            if rodtep is not None:
                source_keys.add(f"rodtep:{rodtep.invsn}:{rodtep.itmsn}")
            out.append((record, source_keys))

    return out
