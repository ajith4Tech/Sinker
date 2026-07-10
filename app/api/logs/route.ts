import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

const LOGS_PATH = path.join(process.cwd(), "data", "logs.json");

/**
 * Processing Log tab data source — reads data/logs.json verbatim (the
 * append-only history scripts/parser.py writes once per run). Never
 * recomputed, never re-reads a PDF; this is what makes the log survive a
 * page refresh.
 */
export async function GET() {
  try {
    const raw = await readFile(LOGS_PATH, "utf-8");
    const data = JSON.parse(raw);
    return NextResponse.json({ logs: Array.isArray(data.logs) ? data.logs : [] });
  } catch {
    return NextResponse.json({ logs: [] });
  }
}
