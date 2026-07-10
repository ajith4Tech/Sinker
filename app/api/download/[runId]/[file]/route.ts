import { readdir, readFile, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { OUTPUT_DIR_ROOT } from "@/lib/run-extract";

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The workbook itself is no longer a per-run disposable file — it's
// persistent server-side state served by /api/download/workbook instead.
// This route now only serves the per-run errors.csv.
const FILES = {
  "errors.csv": {
    contentType: "text/csv",
    downloadName: "sinker-errors.csv",
  },
} as const;

type FileName = keyof typeof FILES;

function isFileName(value: string): value is FileName {
  return value === "errors.csv";
}

// Downloads are one-shot: each file is deleted from disk immediately after
// being read into memory here. There's no database tracking "has this been
// downloaded yet" — the file's presence on disk *is* that state.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; file: string }> }
) {
  const { runId, file } = await params;

  if (!RUN_ID_PATTERN.test(runId) || !isFileName(file)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const runDir = path.join(OUTPUT_DIR_ROOT, runId);
  const filePath = path.join(runDir, file);

  let buffer: Buffer;
  try {
    buffer = await readFile(filePath);
  } catch {
    return NextResponse.json(
      { error: "That file isn't available anymore — it may have already been downloaded." },
      { status: 404 }
    );
  }

  await unlink(filePath).catch(() => undefined);
  const remaining = await readdir(runDir).catch(() => null);
  if (remaining && remaining.length === 0) {
    await rmdir(runDir).catch(() => undefined);
  }

  const { contentType, downloadName } = FILES[file];
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Length": String(buffer.length),
    },
  });
}
