import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { WORKBOOK_PATH } from "@/lib/run-extract";

// The workbook is persistent server-side state (data/workbook.xlsx) — this
// always serves whatever is currently on disk, and never deletes it. Unlike
// the old per-run download, clicking "Download" twice in a row (or after a
// page refresh) serves the exact same file both times.
export async function GET() {
  let buffer: Buffer;
  try {
    buffer = await readFile(WORKBOOK_PATH);
  } catch {
    return NextResponse.json(
      { error: "No workbook has been created yet — run an extraction first." },
      { status: 404 }
    );
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="sinker-output.xlsx"`,
      "Content-Length": String(buffer.length),
    },
  });
}
