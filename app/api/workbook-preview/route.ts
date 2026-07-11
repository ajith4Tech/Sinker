import { NextResponse } from "next/server";
import { readWorkbookPreview } from "@/lib/workbook-preview";

/**
 * Persistent Excel Preview data source — reads data/workbook.xlsx directly
 * (see lib/workbook-preview.ts), independent of any extraction run, so the
 * preview survives a browser refresh or a server restart. Read-only.
 */
export async function GET() {
  try {
    const preview = await readWorkbookPreview();
    if (!preview) {
      return NextResponse.json({ workbook: null, totalRows: 0, updatedAt: null });
    }
    return NextResponse.json(preview);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read the workbook.";
    return NextResponse.json({ workbook: null, totalRows: 0, updatedAt: null, error: message }, { status: 500 });
  }
}
