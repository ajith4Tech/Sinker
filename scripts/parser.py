#!/usr/bin/env python3
"""Extraction batch orchestrator — invoked once per "Extract" click by the
Next.js backend (see lib/run-extract.ts).

Usage:
    python3 parser.py <path-to-manifest.json> [--debug]

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
  - PDF parsing (pdfplumber table extraction + field extraction) happens in
    a worker-process pool — the only parallel part.
  - The workbook is loaded once, the duplicate-detection HashSet is built
    once, and the workbook is saved exactly once at the end — all of this
    happens sequentially in this main process (openpyxl workbooks aren't
    safely shareable across processes).
  - One NDJSON event is printed per finished PDF (flush=True) plus a running
    totals event, so Node can stream live progress to the browser.
  - A single PDF failing is recorded and never aborts the batch.
  - The preview sent to the frontend is built by reading the *saved* .xlsx
    back with openpyxl (see workbook_reader.py) — never from parser JSON —
    so what's shown can never drift from what's downloaded.
  - --debug (developer-only, never wired to the web UI) prints, to stderr,
    every field this run extracted or failed to: label pattern used,
    matched text, extracted value, and the workbook cell it landed in (or,
    on failure, the reason and surrounding context). See _print_debug_log.

Verification: after saving, every LineRecord actually written is checked
against the workbook cells it should have produced (see verify.py) — any
missing/incorrect/shifted value fails the run loudly instead of shipping a
silently-wrong workbook.

Incremental processing (see state_store.py): every discovered PDF is
sha256-hashed and classified against data/state.json (new / changed /
unchanged) *before* any parsing happens — this is emitted as an
"upload_summary" event immediately. Unchanged PDFs are never parsed at all.
data/state.json is purely an index for this skip decision plus a small
cumulative `stats` block for the Statistics tab — the workbook remains the
only source of truth for actual extracted records. data/logs.json is an
append-only processing history for the Processing Log tab. Both files are
loaded once and saved once per run, same as the workbook.
"""

from __future__ import annotations

import csv
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from datetime import datetime, timezone

import state_store
from excel_writer import ExcelWriter
from line_records import build_line_records
from models import ShippingBillResult
from shipping_bill_parser import ShippingBillParser
from template_schema import ATTRS, COLUMNS, HEADER_ROWS, INVOICE_COL, ITEM_COL, SHIPPING_BILL_COL
from utils import discover_pdf_paths
from verify import verify_workbook
from workbook_reader import read_workbook


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_one(path: str) -> dict:
    """Runs inside a worker process: PDF path -> plain dict. Never raises —
    failures are captured and reported back to the main process instead."""
    start = time.monotonic()
    try:
        result = ShippingBillParser().parse_pdf(path)
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


def _debug(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def _print_debug_log(filename: str, debug_log: list[dict]) -> None:
    """--debug output, in exactly the shape requested: for a field that
    resolved to a workbook cell, show what matched and where it landed; for
    one that didn't, show the label that was expected, why it failed, and
    surrounding context — never a silent blank."""
    _debug(f"\n=== PDF: {filename} ===")
    for entry in debug_log:
        _debug(f"Field: {entry['field']}")
        if entry.get("workbook_cell"):
            _debug(f"  Regex Used: {entry['label_pattern']}")
            _debug(f"  Matched Text: {entry.get('matched_text')}")
            _debug(f"  Extracted Value: {entry.get('extracted_value')}")
            _debug(f"  Workbook Cell: {entry['workbook_cell']}")
        else:
            _debug(f"  Expected Label: {entry['label_pattern']}")
            _debug(f"  Reason: {entry.get('reason') or 'value never reached a written workbook row (skipped/duplicate).'}")
            _debug(f"  Context: {entry.get('context') or entry.get('matched_text')}")


def _row_for_display(record: dict, appended: bool, skipped_reason: str | None) -> dict:
    """Converts one LineRecord dict (snake_case, from models.py) into a
    camelCase shape for the NDJSON "rows" list."""
    camel = {}
    for key, value in record.items():
        parts = key.split("_")
        camel_key = parts[0] + "".join(p.title() for p in parts[1:])
        camel[camel_key] = value
    camel["appended"] = appended
    camel["skippedReason"] = skipped_reason
    return camel


def _dedup_key(record: dict) -> str:
    return f"{record['shipping_bill_no']}|{record['invoice_no']}|{record['item_no']}"


def main(argv: list[str]) -> int:
    args = [a for a in argv[1:] if not a.startswith("--")]
    debug = "--debug" in argv[1:] or os.environ.get("PARSER_DEBUG") == "1"

    if len(args) != 1:
        _emit({"type": "fatal", "message": "usage: parser.py <manifest.json> [--debug]"})
        return 1

    with open(args[0], "r", encoding="utf-8") as f:
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

    # --- Incremental processing: classify every discovered PDF against
    # data/state.json (sha256 + size) BEFORE any parsing happens. Unchanged
    # files are never re-read past this point — "Never re-parse unchanged
    # PDFs" — and this is reported to the browser immediately, before
    # extraction starts, as the "Upload Summary".
    state = state_store.load_state()
    logs = state_store.load_logs()

    file_meta: dict[str, dict] = {}
    for path in pdf_paths:
        filename = os.path.basename(path)
        sha256 = state_store.sha256_file(path)
        size = os.path.getsize(path)
        classification = state_store.classify_file(state, filename, sha256, size)
        file_meta[path] = {"filename": filename, "sha256": sha256, "size": size, "classification": classification}

    new_count = sum(1 for m in file_meta.values() if m["classification"] == "new")
    changed_count = sum(1 for m in file_meta.values() if m["classification"] == "changed")
    unchanged_count = sum(1 for m in file_meta.values() if m["classification"] == "unchanged")

    _emit({
        "type": "upload_summary",
        "uploadedPdfs": len(pdf_paths),
        "newPdfs": new_count,
        "alreadyProcessedPdfs": unchanged_count,
        "changedPdfs": changed_count,
        "files": [{"filename": m["filename"], "classification": m["classification"]} for m in file_meta.values()],
    })

    to_process = [p for p in pdf_paths if file_meta[p]["classification"] != "unchanged"]
    to_skip = [p for p in pdf_paths if file_meta[p]["classification"] == "unchanged"]

    totals = {
        "pdfsFound": len(pdf_paths),
        "pdfsProcessed": 0,
        "pdfsFailed": 0,
        "pdfsSkipped": 0,
        "rowsExtracted": 0,
        "rowsAppended": 0,
        "rowsSkipped": 0,
    }
    _emit({"type": "totals", **totals})

    run_started_at = _now_iso()

    # Unchanged PDFs: one Skipped log row each, no parsing, no workbook I/O.
    for path in to_skip:
        filename = file_meta[path]["filename"]
        previously = state["processed"].get(filename, {})
        totals["pdfsSkipped"] += 1
        _emit({
            "type": "file",
            "filename": filename,
            "status": "skipped",
            "classification": "unchanged",
            "portCode": None,
            "shippingBillNo": None,
            "shippingBillDate": None,
            "invoiceCount": 0,
            "rowsExtracted": previously.get("rows", 0),
            "rowsAppended": 0,
            "rowsSkipped": 0,
            "processingTimeMs": 0,
            "error": None,
            "warnings": [
                f"Unchanged since last run (sha256 match) — skipped re-parsing; "
                f"{previously.get('rows', 0)} row(s) previously extracted."
            ],
            "rows": [],
        })
        _emit({"type": "totals", **totals})
        logs.append({
            "filename": filename,
            "status": "Skipped",
            "rowsExtracted": previously.get("rows", 0),
            "rowsAdded": 0,
            "duplicatesSkipped": 0,
            "processingTimeMs": 0,
            "startedAt": run_started_at,
            "completedAt": run_started_at,
            "error": None,
        })

    for path in to_process:
        _emit({"type": "file_start", "filename": file_meta[path]["filename"]})

    errors: list[dict] = []
    written_records: list[dict] = []  # every LineRecord actually written, for Part 4 verification
    max_workers = manifest.get("max_workers") or os.cpu_count() or 4

    with ProcessPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_parse_one, path): path for path in to_process}

        for future in as_completed(futures):
            path = futures[future]
            filename = os.path.basename(path)
            outcome = future.result()

            if not outcome["ok"]:
                totals["pdfsFailed"] += 1
                errors.append({"filename": filename, "error": outcome["error"]})
                # Deliberately NOT written to state["processed"] — a failed
                # PDF must be retried next upload even if it hasn't changed.
                logs.append({
                    "filename": filename,
                    "status": "Failed",
                    "rowsExtracted": 0,
                    "rowsAdded": 0,
                    "duplicatesSkipped": 0,
                    "processingTimeMs": outcome["processingTimeMs"],
                    "startedAt": run_started_at,
                    "completedAt": _now_iso(),
                    "error": outcome["error"],
                })
                _emit({
                    "type": "file",
                    "filename": filename,
                    "status": "failed",
                    "classification": file_meta[path]["classification"],
                    "portCode": None,
                    "shippingBillNo": None,
                    "shippingBillDate": None,
                    "invoiceCount": 0,
                    "rowsExtracted": 0,
                    "rowsAppended": 0,
                    "rowsSkipped": 0,
                    "processingTimeMs": outcome["processingTimeMs"],
                    "error": outcome["error"],
                    "warnings": [],
                    "rows": [],
                })
                _emit({"type": "totals", **totals})
                continue

            result_dict = outcome["result"]
            # Re-hydrate into real dataclass objects for build_line_records —
            # results cross the process-pool boundary as plain JSON dicts.
            result = _rehydrate(result_dict)

            rows_appended = 0
            rows_skipped = 0
            items_missing_key = 0
            warnings = list(result_dict["warnings"])
            emitted_rows: list[dict] = []
            debug_entries = [dict(e) for e in result_dict["debug_log"]]

            line_records = build_line_records(result)
            totals["rowsExtracted"] += len(line_records)

            for record, source_keys in line_records:
                record_dict = record.to_dict()

                if not record_dict["shipping_bill_no"] or not record_dict["invoice_no"] or not record_dict["item_no"]:
                    items_missing_key += 1
                    emitted_rows.append(_row_for_display(record_dict, appended=False, skipped_reason="missing_key"))
                    continue

                key = _dedup_key(record_dict)
                if writer.has_key(key):
                    rows_skipped += 1
                    emitted_rows.append(_row_for_display(record_dict, appended=False, skipped_reason="duplicate"))
                    continue

                cell_map = writer.append_row(key, record)
                rows_appended += 1
                emitted_rows.append(_row_for_display(record_dict, appended=True, skipped_reason=None))
                written_records.append({**record_dict, "_cell_map": cell_map, "_source_pdf": filename})

                for entry in debug_entries:
                    if entry.get("source_key") in source_keys and entry.get("workbook_cell") is None:
                        cell = cell_map.get(entry["field"])
                        if cell:
                            entry["workbook_cell"] = cell

            if items_missing_key:
                warnings.append(
                    f"{items_missing_key} line item(s) skipped: missing Shipping Bill No, "
                    "Invoice No, or Item No, so no de-duplication key could be formed."
                )

            if debug:
                _print_debug_log(filename, debug_entries)

            totals["pdfsProcessed"] += 1
            totals["rowsAppended"] += rows_appended
            totals["rowsSkipped"] += rows_skipped

            meta = file_meta[path]
            state["processed"][filename] = {
                "sha256": meta["sha256"],
                "size": meta["size"],
                "rows": len(line_records),
                "status": "Completed",
                "processed_at": _now_iso(),
            }
            logs.append({
                "filename": filename,
                "status": "Completed",
                "rowsExtracted": len(line_records),
                "rowsAdded": rows_appended,
                "duplicatesSkipped": rows_skipped,
                "processingTimeMs": outcome["processingTimeMs"],
                "startedAt": run_started_at,
                "completedAt": _now_iso(),
                "error": None,
            })

            _emit({
                "type": "file",
                "filename": filename,
                "status": "processed",
                "classification": meta["classification"],
                "portCode": result_dict["port_code"],
                "shippingBillNo": result_dict["shipping_bill_no"],
                "shippingBillDate": result_dict["shipping_bill_date"],
                "invoiceCount": len(result_dict["invoices"]),
                "rowsExtracted": len(line_records),
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

    # PART 2/3: the ONLY source of truth for the preview from here on is the
    # workbook we just saved, read back with openpyxl — never parser JSON.
    workbook_model = read_workbook(manifest["output_xlsx_path"])

    # PART 4: parser output == workbook == preview, or fail loudly.
    validation = verify_workbook(written_records, workbook_model, ATTRS, COLUMNS,
                                  key_cols=(SHIPPING_BILL_COL, INVOICE_COL, ITEM_COL))
    if not validation["ok"]:
        _emit({"type": "validation_failed", "validation": validation})

    # Row numbers appended *this run* (vs. pre-existing in the template) —
    # purely a UI affordance for highlighting, derived from real written
    # cells, never guessed.
    new_row_numbers = sorted({
        int("".join(ch for ch in next(iter(rec["_cell_map"].values())) if ch.isdigit()))
        for rec in written_records if rec["_cell_map"]
    })

    processing_time_ms = int((time.monotonic() - batch_start) * 1000)
    workbook_total_rows = max(0, workbook_model["maxRow"] - HEADER_ROWS)

    # --- Persist the incremental-processing index and processing history —
    # load once (already done above), update in memory, save once each.
    # state.json's `stats` block is a running cumulative total so the
    # Statistics tab can load it verbatim, instantly, without ever opening a
    # PDF or recomputing anything.
    stats = state["stats"]
    stats["totalPdfsProcessed"] += totals["pdfsProcessed"]
    stats["rowsExtracted"] += totals["rowsExtracted"]
    stats["rowsAdded"] += totals["rowsAppended"]
    stats["duplicatesSkipped"] += totals["rowsSkipped"]
    stats["failedPdfs"] += totals["pdfsFailed"]
    stats["uniquePdfs"] = len(state["processed"])
    stats["workbookTotalRows"] = workbook_total_rows
    stats["averageRowsPerPdf"] = round(stats["rowsAdded"] / stats["uniquePdfs"], 2) if stats["uniquePdfs"] else 0
    stats["lastExtraction"] = _now_iso()
    stats["lastProcessingTimeMs"] = processing_time_ms

    state_store.save_state(state)
    state_store.save_logs(logs)

    _emit({
        "type": "summary",
        "newRowNumbers": new_row_numbers,
        "summary": {
            "totalPdfs": len(pdf_paths),
            "successfulPdfs": totals["pdfsProcessed"],
            "failedPdfs": totals["pdfsFailed"],
            "skippedPdfs": totals["pdfsSkipped"],
            "newPdfs": new_count,
            "changedPdfs": changed_count,
            "rowsExtracted": totals["rowsExtracted"],
            "rowsAppended": totals["rowsAppended"],
            "rowsSkipped": totals["rowsSkipped"],
            "workbookTotalRows": workbook_total_rows,
            "processingTimeMs": processing_time_ms,
        },
        "hadErrors": bool(errors),
        "validation": validation,
        "workbook": workbook_model,
    })
    return 0


def _rehydrate(result_dict: dict) -> ShippingBillResult:
    """Rebuilds a ShippingBillResult (with real Invoice/InvoiceItem/
    DrawbackRow/RodtepRow objects, not plain dicts) from the plain dict that
    crossed the process-pool boundary as JSON, so build_line_records() can
    use attribute access and id()-based source tracking exactly as it does
    on the in-process result."""
    from models import DrawbackRow, Invoice, InvoiceItem, RodtepRow

    invoices = [
        Invoice(
            sno=inv["sno"], invoice_no=inv["invoice_no"], invoice_date=inv["invoice_date"],
            exchange_rate=inv["exchange_rate"],
            items=[InvoiceItem(**item) for item in inv["items"]],
        )
        for inv in result_dict["invoices"]
    ]
    drawback_rows = [DrawbackRow(**d) for d in result_dict["drawback_rows"]]
    rodtep_rows = [RodtepRow(**r) for r in result_dict["rodtep_rows"]]

    return ShippingBillResult(
        port_code=result_dict["port_code"],
        shipping_bill_no=result_dict["shipping_bill_no"],
        shipping_bill_date=result_dict["shipping_bill_date"],
        invoices=invoices,
        drawback_rows=drawback_rows,
        rodtep_rows=rodtep_rows,
        warnings=result_dict["warnings"],
        debug_log=[],
    )


if __name__ == "__main__":
    sys.exit(main(sys.argv))
