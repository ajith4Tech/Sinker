import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const STATE_PATH = path.join(process.cwd(), "data", "state.json");
const WORKBOOK_PATH = path.join(process.cwd(), "data", "workbook.xlsx");

const EMPTY_STATS = {
  totalPdfsProcessed: 0,
  uniquePdfs: 0,
  rowsExtracted: 0,
  rowsAdded: 0,
  duplicatesSkipped: 0,
  failedPdfs: 0,
  workbookTotalRows: 0,
  averageRowsPerPdf: 0,
  lastExtraction: null,
  lastProcessingTimeMs: 0,
};

/**
 * Statistics tab data source — reads data/state.json verbatim. No PDF is
 * ever opened here, no workbook is re-read: this is scripts/parser.py's own
 * cumulative `stats` block, already computed once per run, so this loads
 * instantly regardless of how many PDFs have ever been processed.
 */
export async function GET() {
  const hasWorkbook = await stat(WORKBOOK_PATH)
    .then(() => true)
    .catch(() => false);

  try {
    const raw = await readFile(STATE_PATH, "utf-8");
    const state = JSON.parse(raw);
    return NextResponse.json({ stats: { ...EMPTY_STATS, ...state.stats }, hasWorkbook });
  } catch {
    return NextResponse.json({ stats: EMPTY_STATS, hasWorkbook });
  }
}
