import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { WORKBOOK_PATH } from "@/lib/run-extract";
import type { WorkbookModel, WorkbookPreviewResponse } from "@/lib/types";

const READ_WORKBOOK_SCRIPT = path.join(process.cwd(), "scripts", "read_workbook_cli.py");

// Mirrors lib/run-extract.ts's own resolvePythonBin — duplicated rather than
// exported from there, so this read-only preview path never has to modify
// the extraction engine module.
function resolvePythonBin(): string {
  if (process.env.PYTHON_BIN) return process.env.PYTHON_BIN;
  for (const venvDir of ["venv", ".venv"]) {
    const candidate = path.join(process.cwd(), venvDir, "bin", "python3");
    if (existsSync(candidate)) return candidate;
  }
  return "python3";
}

function parseFreezeRow(freezePanes: string | null): number | null {
  if (!freezePanes) return null;
  const m = /^[A-Z]+(\d+)$/.exec(freezePanes);
  return m ? Number(m[1]) : null;
}

/**
 * Reads data/workbook.xlsx fresh, exactly once, via
 * scripts/read_workbook_cli.py (a thin wrapper around the same
 * workbook_reader.py module scripts/parser.py already uses to build the
 * "done" event's preview). Returns null if no workbook has been created
 * yet. Never reads on every render — callers own when this gets invoked
 * (page load / after extraction / manual refresh).
 */
export async function readWorkbookPreview(): Promise<WorkbookPreviewResponse | null> {
  const fileStat = await stat(WORKBOOK_PATH).catch(() => null);
  if (!fileStat) return null;

  const pythonBin = resolvePythonBin();
  const workbook = await new Promise<WorkbookModel>((resolve, reject) => {
    const child = spawn(pythonBin, [READ_WORKBOOK_SCRIPT, WORKBOOK_PATH]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `read_workbook_cli.py exited with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(err instanceof Error ? err : new Error("Failed to parse workbook preview output."));
      }
    });
  });

  const freezeRow = parseFreezeRow(workbook.freezePanes);
  const headerRowCount = freezeRow ? freezeRow - 1 : 0;
  const totalRows = Math.max(0, workbook.maxRow - headerRowCount);

  return { workbook, totalRows, updatedAt: fileStat.mtime.toISOString() };
}
