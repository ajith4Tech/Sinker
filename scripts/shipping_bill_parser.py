"""ShippingBillParser: Shipping Bill PDF -> ShippingBillResult.

Deterministic, label-based extraction only — no AI, no OCR, no ML. Every
field has its own extraction call below; if a label can't be found (or its
value cell is blank), the field stays `None` and an ExtractionLogEntry
records exactly why — this class never guesses or infers a value.

Text-extraction strategy: see pdf_tables.py's module docstring for why this
uses pdfplumber's ruled-table grid (find_tables()) rather than plain
top-to-bottom text — this document's rotated sidebar labels and dense tables
make naive text extraction unusable. Every extractor here follows the same
shape: find a row containing a known label (regex, tolerant of spacing/case,
never a hardcoded page coordinate), then read the value from the same
column index in a nearby row.

Structure mirrors the real annexure: PART I is the bill-level header (Port
Code, Shipping Bill No/Date) and appears identically on every page, so it's
read once from page 1. PART II/III repeat once per Invoice (one page group
per S.No on multi-invoice bills). PART IV's Drawback (A) and RODTEP (M)
claim tables can land on any page depending on how many rows they need, so
every page is checked for both regardless of which PART it's otherwise in.
"""

from __future__ import annotations

import re
from typing import Optional

import pdfplumber

from models import (
    DrawbackRow,
    ExtractionLogEntry,
    Invoice,
    InvoiceItem,
    RodtepRow,
    ShippingBillResult,
)
from pdf_tables import (
    Row,
    find_col_index,
    find_row_index,
    get_table_rows,
    iter_section_rows,
    value_at,
    values_from,
)


class ShippingBillParser:
    def parse_pdf(self, path: str) -> ShippingBillResult:
        result = ShippingBillResult()

        with pdfplumber.open(path) as pdf:
            pages_rows = [get_table_rows(page) for page in pdf.pages]

        if not pages_rows:
            result.warnings.append("PDF had no pages.")
            return result

        self._extract_header(pages_rows[0], result)

        for rows in pages_rows:
            if find_row_index(rows, r"1\.S\.No\b") is not None:
                invoice = self._extract_invoice(rows, result.debug_log)
                if invoice is not None:
                    result.invoices.append(invoice)

            if find_row_index(rows, r"A\.\s*DRAWBACK\s*&?\s*ROSL\s*CLAIM") is not None:
                result.drawback_rows.extend(self._extract_drawback(rows, result.debug_log))

            if find_row_index(rows, r"M\.\s*RODTEP\s*DETAILS") is not None:
                result.rodtep_rows.extend(self._extract_rodtep(rows, result.debug_log))

        if not result.port_code and not result.shipping_bill_no:
            result.warnings.append("Shipping Bill header (Port Code / SB No / SB Date) not found in document.")
        if not result.invoices:
            result.warnings.append("No invoices (PART II) could be extracted from this document.")
        if not result.drawback_rows:
            result.warnings.append("No Drawback claim rows found (PART IV-A) — DBK may not be claimed on this bill.")
        if not result.rodtep_rows:
            result.warnings.append("No RODTEP rows found (PART IV-M) — RODTEP may not be claimed on this bill.")

        return result

    # ------------------------------------------------------------------
    # PART I — Shipping Bill Summary header (Port Code / SB No / SB Date)
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_header(rows: Row, result: ShippingBillResult) -> None:
        log = result.debug_log
        pattern = r"Port\s*Code"
        header_idx = find_row_index(rows, pattern)

        if header_idx is None:
            for field_name in ("Port Code", "Shipping Bill No", "Shipping Bill Date"):
                log.append(ExtractionLogEntry(
                    field=field_name,
                    label_pattern=pattern,
                    status="not_found",
                    reason="Label 'Port Code' not found on page 1.",
                ))
            return

        col = find_col_index(rows[header_idx], pattern)
        data_row = rows[header_idx + 1] if header_idx + 1 < len(rows) else None
        port_code, sb_no, sb_date = values_from(data_row, col, 3)

        result.port_code = port_code
        result.shipping_bill_no = sb_no
        result.shipping_bill_date = sb_date

        matched_text = str(data_row) if data_row is not None else None
        for field_name, value in (
            ("Port Code", port_code),
            ("Shipping Bill No", sb_no),
            ("Shipping Bill Date", sb_date),
        ):
            log.append(ExtractionLogEntry(
                field=field_name,
                label_pattern=pattern,
                matched_text=matched_text,
                extracted_value=value,
                status="ok" if value else "empty",
                reason=None if value else "Label row found but value cell was blank.",
                source_key="header",
            ))

    # ------------------------------------------------------------------
    # PART II — Invoice Details (one Invoice per page-group)
    # ------------------------------------------------------------------
    @classmethod
    def _extract_invoice(cls, rows: Row, log: list[ExtractionLogEntry]) -> Optional[Invoice]:
        invoice = Invoice()
        cls._extract_invoice_ref(rows, invoice, log)
        cls._extract_exchange_rate(rows, invoice, log)
        invoice.items = cls._extract_items(rows, log, invoice.sno)

        if not any([invoice.sno, invoice.invoice_no, invoice.invoice_date, invoice.exchange_rate, invoice.items]):
            return None
        return invoice

    @staticmethod
    def _extract_invoice_ref(rows: Row, invoice: Invoice, log: list[ExtractionLogEntry]) -> None:
        pattern = r"1\.S\.No\b"
        header_idx = find_row_index(rows, pattern)
        if header_idx is None:
            for field_name in ("Invoice No", "Invoice Date"):
                log.append(ExtractionLogEntry(field=field_name, label_pattern=pattern, status="not_found",
                                               reason="'1.S.No' reference row not found."))
            return

        header_row = rows[header_idx]
        sno_col = find_col_index(header_row, pattern)
        invno_col = find_col_index(header_row, r"INVOICE\s*No\.?\s*&\s*Dt")

        data_row = rows[header_idx + 1] if header_idx + 1 < len(rows) else None
        invoice.sno = value_at(rows, header_idx + 1, sno_col)
        raw = value_at(rows, header_idx + 1, invno_col)

        matched_text = str(data_row) if data_row is not None else None
        invno_pattern = r"INVOICE\s*No\.?\s*&\s*Dt"
        if raw is None:
            for field_name in ("Invoice No", "Invoice Date"):
                log.append(ExtractionLogEntry(field=field_name, label_pattern=invno_pattern,
                                               matched_text=matched_text, status="empty",
                                               reason="Label found but 'Invoice No. & Dt.' cell was blank."))
            return

        m = re.match(r"^(\S+)\s+(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$", raw)
        if m:
            invoice.invoice_no, invoice.invoice_date = m.group(1), m.group(2)
            log.append(ExtractionLogEntry(field="Invoice No", label_pattern=invno_pattern,
                                           matched_text=raw, extracted_value=invoice.invoice_no, status="ok",
                                           source_key=f"invoice:{invoice.sno}"))
            log.append(ExtractionLogEntry(field="Invoice Date", label_pattern=invno_pattern,
                                           matched_text=raw, extracted_value=invoice.invoice_date, status="ok",
                                           source_key=f"invoice:{invoice.sno}"))
        else:
            invoice.invoice_no = raw
            log.append(ExtractionLogEntry(field="Invoice No", label_pattern=invno_pattern,
                                           matched_text=raw, extracted_value=raw, status="ok",
                                           source_key=f"invoice:{invoice.sno}"))
            log.append(ExtractionLogEntry(field="Invoice Date", label_pattern=invno_pattern,
                                           matched_text=raw, status="not_found",
                                           reason="Combined cell did not contain a trailing date after the invoice number.",
                                           source_key=f"invoice:{invoice.sno}"))

    @staticmethod
    def _extract_exchange_rate(rows: Row, invoice: Invoice, log: list[ExtractionLogEntry]) -> None:
        pattern = r"1\.INVOICE\s*VALUE"
        header_idx = find_row_index(rows, pattern)
        if header_idx is None:
            log.append(ExtractionLogEntry(field="Exchange Rate", label_pattern=pattern, status="not_found",
                                           reason="'1.INVOICE VALUE' valuation row not found."))
            return

        rate_pattern = r"EXCHANGE\s*RATE"
        col = find_col_index(rows[header_idx], rate_pattern)
        raw = value_at(rows, header_idx + 1, col)
        if raw is None:
            log.append(ExtractionLogEntry(field="Exchange Rate", label_pattern=rate_pattern, status="not_found",
                                           reason="'EXCHANGE RATE' column found but value cell was blank.",
                                           context=str(rows[header_idx])))
            return

        m = re.search(r"([\d.]+)\s*$", raw)
        if m:
            invoice.exchange_rate = m.group(1)
            log.append(ExtractionLogEntry(field="Exchange Rate", label_pattern=rate_pattern,
                                           matched_text=raw, extracted_value=invoice.exchange_rate, status="ok",
                                           source_key=f"invoice:{invoice.sno}"))
        else:
            log.append(ExtractionLogEntry(field="Exchange Rate", label_pattern=rate_pattern,
                                           matched_text=raw, status="not_found",
                                           reason="Value cell did not end in a numeric rate.", context=raw,
                                           source_key=f"invoice:{invoice.sno}"))

    @staticmethod
    def _extract_items(rows: Row, log: list[ExtractionLogEntry], invoice_sno) -> list[InvoiceItem]:
        pattern = r"1\.ItemSNo"
        header_idx = find_row_index(rows, pattern)
        field_names = {
            "item_sno": "Item No",
            "hs_code": "HSN Code",
            "description": "Product Description",
            "quantity": "Quantity",
            "uqc": "UQC",
            "unit_rate": "Unit Rate",
            "item_value_fcy": "Item Value (FCY)",
        }
        col_patterns = {
            "item_sno": r"1\.ItemSNo",
            "hs_code": r"HS\s*CD",
            "description": r"DESCRIPTION",
            "quantity": r"QUANTITY",
            "uqc": r"\bUQC\b",
            "unit_rate": r"\bRATE\b",
            "item_value_fcy": r"VALUE\s*\(F/C\)",
        }

        if header_idx is None:
            for name, field_name in field_names.items():
                log.append(ExtractionLogEntry(field=field_name, label_pattern=col_patterns[name], status="not_found",
                                               reason="'1.ItemSNo' item-table header row not found."))
            return []

        header_row = rows[header_idx]
        cols = {name: find_col_index(header_row, pat) for name, pat in col_patterns.items()}

        def _stop(row: Row) -> bool:
            return any(c and re.search(r"glossary", c, re.IGNORECASE) for c in row)

        items = []
        for _, row in iter_section_rows(rows, header_idx + 1, _stop):
            values = {}
            for name in col_patterns:
                col = cols[name]
                value = row[col] if col is not None and col < len(row) else None
                values[name] = value

            item = InvoiceItem(**values)
            if any(getattr(item, f) for f in item.__dataclass_fields__):
                items.append(item)
                for name, field_name in field_names.items():
                    value = values[name]
                    log.append(ExtractionLogEntry(
                        field=field_name, label_pattern=col_patterns[name],
                        matched_text=str(row), extracted_value=value,
                        status="ok" if value else "empty",
                        reason=None if value else f"Column found but cell blank for item {values.get('item_sno')}.",
                        source_key=f"item:{invoice_sno}:{values.get('item_sno')}",
                    ))
        return items

    # ------------------------------------------------------------------
    # PART IV-A — Drawback & ROSL Claim
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_drawback(rows: Row, log: list[ExtractionLogEntry]) -> list[DrawbackRow]:
        field_names = {
            "inv_sno": "1.INV SNO",
            "item_sno": "2.ITEM SNO",
            "dbk_sno": "3.DBK SNO.",
            "qty_wt": "4.QTY/WT",
            "value": "5.VALUE",
            "rate": "6.RATE",
            "dbk_amt": "7.DBK AMT",
            "stalev": "8.STALEV",
            "cenlev": "9.CENLEV",
            "rosctl_amt": "10.ROSCTL AMT",
        }
        col_patterns = {
            "inv_sno": r"1\.INV\s*SNO",
            "item_sno": r"2\.ITEM\s*SNO",
            "dbk_sno": r"3\.DBK\s*SNO",
            "qty_wt": r"4\.QTY\s*/\s*WT",
            "value": r"5\.VALUE",
            "rate": r"6\.RATE",
            "dbk_amt": r"7\.DBK\s*AMT",
            "stalev": r"8\.STALEV",
            "cenlev": r"9\.CENLEV",
            "rosctl_amt": r"10\.ROSCTL\s*AMT",
        }

        section_idx = find_row_index(rows, r"A\.\s*DRAWBACK\s*&?\s*ROSL\s*CLAIM")
        if section_idx is None:
            return []

        header_idx = find_row_index(rows, r"1\.INV\s*SNO", start=section_idx)
        if header_idx is None:
            for name, field_name in field_names.items():
                log.append(ExtractionLogEntry(field=field_name, label_pattern=col_patterns[name], status="not_found",
                                               reason="'A. DRAWBACK & ROSL CLAIM' section found but its column header row was not."))
            return []

        header_row = rows[header_idx]
        cols = {name: find_col_index(header_row, pat) for name, pat in col_patterns.items()}

        def _stop(row: Row) -> bool:
            return any(c and re.search(r"B\.\s*AA\s*/\s*DFIA", c, re.IGNORECASE) for c in row)

        out = []
        for _, row in iter_section_rows(rows, header_idx + 1, _stop):
            values = {}
            for name in col_patterns:
                col = cols[name]
                values[name] = row[col] if col is not None and col < len(row) else None

            entry = DrawbackRow(**values)
            if any(getattr(entry, f) for f in entry.__dataclass_fields__):
                out.append(entry)
                for name, field_name in field_names.items():
                    value = values[name]
                    log.append(ExtractionLogEntry(
                        field=field_name, label_pattern=col_patterns[name],
                        matched_text=str(row), extracted_value=value,
                        status="ok" if value else "empty",
                        reason=None if value else f"Column found but cell blank for Inv SNo {values.get('inv_sno')}.",
                        source_key=f"drawback:{values.get('inv_sno')}:{values.get('item_sno')}",
                    ))
        return out

    # ------------------------------------------------------------------
    # PART IV-M — RODTEP Details
    # ------------------------------------------------------------------
    @staticmethod
    def _extract_rodtep(rows: Row, log: list[ExtractionLogEntry]) -> list[RodtepRow]:
        field_names = {
            "invsn": "1.INVSN",
            "itmsn": "2.ITMSN",
            "quantity": "3. QUANTITY",
            "uqc": "4. UQC",
            "no_of_units": "5. NO. OF UNITS",
            "value": "6. VALUE",
        }
        col_patterns = {
            "invsn": r"1\.INVSN",
            "itmsn": r"2\.ITMSN",
            "quantity": r"3\.\s*QUANTITY",
            "uqc": r"4\.\s*UQC",
            "no_of_units": r"5\.\s*NO\.\s*OF\s*UNITS",
            "value": r"6\.\s*VALUE",
        }

        section_idx = find_row_index(rows, r"M\.\s*RODTEP\s*DETAILS")
        if section_idx is None:
            return []

        header_idx = find_row_index(rows, r"1\.INVSN", start=section_idx)
        if header_idx is None:
            for name, field_name in field_names.items():
                log.append(ExtractionLogEntry(field=field_name, label_pattern=col_patterns[name], status="not_found",
                                               reason="'M. RODTEP DETAILS' section found but its column header row was not."))
            return []

        header_row = rows[header_idx]
        cols = {name: find_col_index(header_row, pat) for name, pat in col_patterns.items()}

        def _stop(row: Row) -> bool:
            return any(c and re.search(r"N\.\s*REEXPORT", c, re.IGNORECASE) for c in row)

        out = []
        for _, row in iter_section_rows(rows, header_idx + 1, _stop):
            values = {}
            for name in col_patterns:
                col = cols[name]
                values[name] = row[col] if col is not None and col < len(row) else None

            entry = RodtepRow(**values)
            if any(getattr(entry, f) for f in entry.__dataclass_fields__):
                out.append(entry)
                for name, field_name in field_names.items():
                    value = values[name]
                    log.append(ExtractionLogEntry(
                        field=field_name, label_pattern=col_patterns[name],
                        matched_text=str(row), extracted_value=value,
                        status="ok" if value else "empty",
                        reason=None if value else f"Column found but cell blank for InvSN {values.get('invsn')}.",
                        source_key=f"rodtep:{values.get('invsn')}:{values.get('itmsn')}",
                    ))
        return out
