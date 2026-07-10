#!/usr/bin/env python3
"""Extraction batch orchestrator — invoked once per "Extract" click by the
Next.js backend (see lib/run-extract.ts).

Usage:
    python3 parser.py <path-to-manifest.json>

The manifest (written by Node) is a JSON object:
    {
      "input_paths": [...],       # uploaded .pdf and/or .zip paths
      "extract_dir": "...",       # scratch dir for expanding zips into
      "template_path": "...",     # .xlsx to load and append to
      "output_xlsx_path": "...",  # where to save the result
      "errors_csv_path": "...",   # where to write errors.csv, if any
      "max_workers": 4            # optional
    }

Behavior, matching the performance/error-handling requirements:
  - PDF text extraction + field parsing happens in a worker-process pool —
    the only parallel part.
  - The workbook is loaded once, the duplicate-detection HashSet is built
    once, and the workbook is saved exactly once at the end — all of this
    happens sequentially in this main process (openpyxl workbooks aren't
    safely shareable across processes).
  - One NDJSON event is printed per finished PDF (flush=True) plus a running
    totals event, so Node can stream live progress to the browser.
  - A single PDF failing is recorded and never aborts the batch.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed

from excel_writer import ExcelWriter
from shipping_bill_parser import ShippingBillParser
from utils import discover_pdf_paths, extract_pdf_text, unique_key


def _parse_one(path: str) -> dict:
    """Runs inside a worker process: PDF path -> plain dict. Never raises —
    failures are captured and reported back to the main process instead."""
    start = time.monotonic()
    try:
        text = extract_pdf_text(path)
        result = ShippingBillParser().parse(text)
        return {
            "ok": True,
            "result": result.to_dict(),
            "processingTimeMs": int((time.monotonic() - start) * 1000),
        }
    except Exception as exc:  # noqa: BLE001 - any failure becomes a structured error
        return {
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
            "processingTimeMs": int((time.monotonic() - start) * 1000),
        }


def _emit(event: dict) -> None:
    print(json.dumps(event), flush=True)


def _row_for_display(item: dict, appended: bool, skipped_reason: str | None) -> dict:
    """Converts one LineItem dict (snake_case, from models.py) into the
    camelCase shape lib/types.ts's ExtractedRow expects."""
    return {
        "itemNumber": item["item_number"],
        "hsCode": item["hs_code"],
        "description": item["description"],
        "quantity": item["quantity"],
        "uqc": item["uqc"],
        "rate": item["rate"],
        "fob": item["fob"],
        "invoiceValue": item["invoice_value"],
        "drawback": item["drawback"],
        "rodtep": item["rodtep"],
        "appended": appended,
        "skippedReason": skipped_reason,
    }


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        _emit({"type": "fatal", "message": "usage: parser.py <manifest.json>"})
        return 1

    with open(argv[1], "r", encoding="utf-8") as f:
        manifest = json.load(f)

    batch_start = time.monotonic()

    try:
        pdf_paths = discover_pdf_paths(manifest["input_paths"], manifest["extract_dir"])
    except Exception as exc:  # noqa: BLE001
        _emit({"type": "fatal", "message": f"Could not read the uploaded files: {exc}"})
        return 1

    if not pdf_paths:
        _emit({"type": "fatal", "message": "No PDF files were found in the upload."})
        return 1

    try:
        writer = ExcelWriter(manifest["template_path"])
    except Exception as exc:  # noqa: BLE001
        _emit({"type": "fatal", "message": f"Could not open the template workbook: {exc}"})
        return 1

    totals = {
        "pdfsFound": len(pdf_paths),
        "pdfsProcessed": 0,
        "pdfsFailed": 0,
        "rowsExtracted": 0,
        "rowsAppended": 0,
        "rowsSkipped": 0,
    }
    _emit({"type": "totals", **totals})

    errors: list[dict] = []
    max_workers = manifest.get("max_workers") or os.cpu_count() or 4

    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_parse_one, path): path for path in pdf_paths}

        for future in as_completed(futures):
            path = futures[future]
            filename = os.path.basename(path)
            outcome = future.result()

            if not outcome["ok"]:
                totals["pdfsFailed"] += 1
                errors.append({"filename": filename, "error": outcome["error"]})
                _emit({
                    "type": "file",
                    "filename": filename,
                    "status": "failed",
                    "shippingBill": None,
                    "shippingBillDate": None,
                    "invoiceNumber": None,
                    "invoiceDate": None,
                    "iec": None,
                    "gstin": None,
                    "portCode": None,
                    "exchangeRate": None,
                    "rowsAppended": 0,
                    "rowsSkipped": 0,
                    "processingTimeMs": outcome["processingTimeMs"],
                    "error": outcome["error"],
                    "warnings": [],
                    "rows": [],
                })
                _emit({"type": "totals", **totals})
                continue

            result = outcome["result"]
            rows_appended = 0
            rows_skipped = 0
            items_missing_key = 0
            warnings = list(result["warnings"])
            emitted_rows: list[dict] = []

            for item in result["items"]:
                totals["rowsExtracted"] += 1

                if not result["shipping_bill"] or not result["invoice_number"] or not item["item_number"]:
                    # Can't form a de-duplication key — skip this line item
                    # rather than guess at a substitute identifier.
                    items_missing_key += 1
                    emitted_rows.append(_row_for_display(item, appended=False, skipped_reason="missing_key"))
                    continue

                key = unique_key(result["shipping_bill"], result["invoice_number"], item["item_number"])

                if writer.has_key(key):
                    rows_skipped += 1
                    emitted_rows.append(_row_for_display(item, appended=False, skipped_reason="duplicate"))
                    continue

                writer.append_row(key, [
                    result["shipping_bill"],
                    result["shipping_bill_date"],
                    result["invoice_number"],
                    result["invoice_date"],
                    item["item_number"],
                    item["hs_code"],
                    item["description"],
                    item["quantity"],
                    item["uqc"],
                    item["rate"],
                    item["fob"],
                    item["invoice_value"],
                    item["drawback"],
                    item["rodtep"],
                    result["exchange_rate"],
                    result["iec"],
                    result["gstin"],
                    result["port_code"],
                    filename,
                ])
                rows_appended += 1
                emitted_rows.append(_row_for_display(item, appended=True, skipped_reason=None))

            if items_missing_key:
                warnings.append(
                    f"{items_missing_key} line item(s) skipped: missing Shipping Bill No, "
                    "Invoice No, or Item No, so no de-duplication key could be formed."
                )

            totals["pdfsProcessed"] += 1
            totals["rowsAppended"] += rows_appended
            totals["rowsSkipped"] += rows_skipped

            _emit({
                "type": "file",
                "filename": filename,
                "status": "processed",
                "shippingBill": result["shipping_bill"],
                "shippingBillDate": result["shipping_bill_date"],
                "invoiceNumber": result["invoice_number"],
                "invoiceDate": result["invoice_date"],
                "iec": result["iec"],
                "gstin": result["gstin"],
                "portCode": result["port_code"],
                "exchangeRate": result["exchange_rate"],
                "rowsAppended": rows_appended,
                "rowsSkipped": rows_skipped,
                "processingTimeMs": outcome["processingTimeMs"],
                "error": None,
                "warnings": warnings,
                "rows": emitted_rows,
            })
            _emit({"type": "totals", **totals})

    writer.save(manifest["output_xlsx_path"])

    if errors:
        with open(manifest["errors_csv_path"], "w", newline="", encoding="utf-8") as f:
            csv_writer = csv.DictWriter(f, fieldnames=["filename", "error"])
            csv_writer.writeheader()
            csv_writer.writerows(errors)

    _emit({
        "type": "summary",
        "summary": {
            "totalPdfs": len(pdf_paths),
            "successfulPdfs": totals["pdfsProcessed"],
            "failedPdfs": totals["pdfsFailed"],
            "rowsExtracted": totals["rowsExtracted"],
            "rowsAppended": totals["rowsAppended"],
            "rowsSkipped": totals["rowsSkipped"],
            "processingTimeMs": int((time.monotonic() - batch_start) * 1000),
        },
        "hadErrors": bool(errors),
    })
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
