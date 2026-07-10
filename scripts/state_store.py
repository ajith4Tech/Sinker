"""Lightweight JSON-file persistence for incremental processing and
processing history — no database, per the product requirement. Two files:

  data/state.json — an INDEX only: which PDFs (by filename) have already
    been processed, keyed by sha256+size so an unchanged re-upload can skip
    parsing entirely, plus a small cumulative `stats` block for the
    Statistics tab. The *workbook* stays the only source of truth for the
    actual extracted records — this file never stores row data itself.

  data/logs.json — append-only processing history (one entry per PDF per
    run), for the Processing Log tab. Entries are never removed.

Both are read once and written once per parser.py run (see the
PERFORMANCE requirements) — never per-file.
"""

from __future__ import annotations

import hashlib
import json
import os

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
STATE_PATH = os.path.join(DATA_DIR, "state.json")
LOGS_PATH = os.path.join(DATA_DIR, "logs.json")

DEFAULT_STATS = {
    "totalPdfsProcessed": 0,
    "uniquePdfs": 0,
    "rowsExtracted": 0,
    "rowsAdded": 0,
    "duplicatesSkipped": 0,
    "failedPdfs": 0,
    "workbookTotalRows": 0,
    "averageRowsPerPdf": 0,
    "lastExtraction": None,
    "lastProcessingTimeMs": 0,
}


def sha256_file(path: str) -> str:
    """Streams the file in chunks — never loads a whole PDF into memory
    just to hash it."""
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_state() -> dict:
    if not os.path.exists(STATE_PATH):
        return {"processed": {}, "stats": dict(DEFAULT_STATS)}
    with open(STATE_PATH, "r", encoding="utf-8") as f:
        state = json.load(f)
    state.setdefault("processed", {})
    state.setdefault("stats", {})
    for key, value in DEFAULT_STATS.items():
        state["stats"].setdefault(key, value)
    return state


def save_state(state: dict) -> None:
    """Atomic write (tmp file + rename) so a crash mid-write never leaves a
    corrupt state.json behind."""
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp_path = STATE_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)
    os.replace(tmp_path, STATE_PATH)


def load_logs() -> list[dict]:
    if not os.path.exists(LOGS_PATH):
        return []
    with open(LOGS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data.get("logs", [])


def save_logs(logs: list[dict]) -> None:
    os.makedirs(DATA_DIR, exist_ok=True)
    tmp_path = LOGS_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump({"logs": logs}, f, indent=2)
    os.replace(tmp_path, LOGS_PATH)


def classify_file(state: dict, filename: str, sha256: str, size: int) -> str:
    """Returns "new" | "unchanged" | "changed" for this filename — purely
    from the state.json index, never by re-reading or re-parsing the PDF."""
    existing = state["processed"].get(filename)
    if existing is None:
        return "new"
    if existing.get("sha256") == sha256 and existing.get("size") == size:
        return "unchanged"
    return "changed"
