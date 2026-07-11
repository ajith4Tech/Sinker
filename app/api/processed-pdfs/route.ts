import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import type { LogEntry, ProcessedPdfEntry, ProcessedPdfsSummary } from "@/lib/types";

const STATE_PATH = path.join(process.cwd(), "data", "state.json");
const LOGS_PATH = path.join(process.cwd(), "data", "logs.json");

interface ProcessedFileMeta {
  sha256: string;
  size: number;
  rows: number;
  status: string;
  processed_at: string;
}

/**
 * Processed PDFs tab data source — reads data/logs.json (append-only
 * history) and data/state.json (current sha256/size per filename) verbatim,
 * same files the Processing Log and Statistics tabs already read. Nothing
 * here is recomputed by re-parsing a PDF or the workbook.
 *
 * data/logs.json only records "Completed" / "Skipped" / "Failed" per run —
 * it never stored a new-vs-changed classification. That's derived here,
 * purely from log order: a filename's first "Completed" entry is
 * "Processed"; any later "Completed" entry for the same filename must be a
 * content change, because an unchanged re-upload always produces a
 * "Skipped" entry instead (see scripts/state_store.classify_file). This
 * mirrors that function's own logic without touching it.
 */
export async function GET() {
  const [logs, processedMeta] = await Promise.all([loadLogs(), loadProcessedMeta()]);

  const seenCompleted = new Set<string>();
  const entries: ProcessedPdfEntry[] = logs.map((log) => {
    let status: ProcessedPdfEntry["status"];
    if (log.status === "Failed") {
      status = "Failed";
    } else if (log.status === "Skipped") {
      status = "Skipped Duplicate";
    } else {
      status = seenCompleted.has(log.filename) ? "Changed" : "Processed";
      seenCompleted.add(log.filename);
    }

    const meta = processedMeta[log.filename];
    return {
      filename: log.filename,
      status,
      rowsExtracted: log.rowsExtracted,
      rowsAdded: log.rowsAdded,
      duplicatesSkipped: log.duplicatesSkipped,
      // A failed attempt's own hash was never persisted (state.json
      // deliberately skips failed PDFs so they're retried) — whatever meta
      // exists for that filename would be a stale, unrelated version.
      sha256: status === "Failed" ? null : (meta?.sha256 ?? null),
      processedAt: log.completedAt,
      lastModified: meta?.processed_at ?? null,
    };
  });

  entries.reverse(); // logs.json is append-only oldest-first; UI wants newest first

  const summary: ProcessedPdfsSummary = {
    totalPdfs: entries.length,
    processed: entries.filter((e) => e.status === "Processed").length,
    skipped: entries.filter((e) => e.status === "Skipped Duplicate").length,
    failed: entries.filter((e) => e.status === "Failed").length,
    changed: entries.filter((e) => e.status === "Changed").length,
  };

  return NextResponse.json({ entries, summary });
}

async function loadLogs(): Promise<LogEntry[]> {
  try {
    const raw = await readFile(LOGS_PATH, "utf-8");
    const data = JSON.parse(raw);
    return Array.isArray(data.logs) ? data.logs : [];
  } catch {
    return [];
  }
}

async function loadProcessedMeta(): Promise<Record<string, ProcessedFileMeta>> {
  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const data = JSON.parse(raw);
    return data.processed && typeof data.processed === "object" ? data.processed : {};
  } catch {
    return {};
  }
}
