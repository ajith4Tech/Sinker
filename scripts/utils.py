"""Shared, framework-free helpers used by parser.py.

Nothing here knows about PDF field extraction (shipping_bill_parser.py) or
Excel (excel_writer.py) — just file discovery and text acquisition.
"""

from __future__ import annotations

import os
import zipfile


def discover_pdf_paths(input_paths: list[str], extract_dir: str) -> list[str]:
    """Expands any .zip entries in `input_paths` into `extract_dir` and
    returns the flat list of resulting .pdf paths; direct PDF inputs pass
    through unchanged.

    Guards against zip-slip (a malicious .zip entry using "../" to write
    outside extract_dir) by resolving each entry's real path and skipping
    anything that would land outside extract_dir.
    """
    os.makedirs(extract_dir, exist_ok=True)
    safe_root = os.path.realpath(extract_dir)
    pdf_paths: list[str] = []

    for path in input_paths:
        lower = path.lower()

        if lower.endswith(".pdf"):
            pdf_paths.append(path)
            continue

        if not lower.endswith(".zip"):
            continue

        with zipfile.ZipFile(path) as zf:
            for member in zf.namelist():
                if not member.lower().endswith(".pdf") or member.startswith("__MACOSX/"):
                    continue

                dest = os.path.realpath(os.path.join(safe_root, member))
                if not (dest == safe_root or dest.startswith(safe_root + os.sep)):
                    continue  # zip-slip attempt — skip this entry

                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(member) as src, open(dest, "wb") as out:
                    out.write(src.read())
                pdf_paths.append(dest)

    return pdf_paths


def extract_pdf_text(path: str) -> str:
    """Reads all text from a PDF. Tries pdfplumber first (better
    layout/whitespace fidelity for label-based regex matching); falls back
    to PyMuPDF if pdfplumber can't open the file."""
    try:
        import pdfplumber

        with pdfplumber.open(path) as pdf:
            text = "\n".join(page.extract_text() or "" for page in pdf.pages)
        if text.strip():
            return text
    except Exception:
        pass

    import fitz  # PyMuPDF

    doc = fitz.open(path)
    try:
        return "\n".join(page.get_text() for page in doc)
    finally:
        doc.close()


def unique_key(shipping_bill: str, invoice_number: str, item_number: str) -> str:
    return f"{shipping_bill}|{invoice_number}|{item_number}"
