import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtractEvent, ExtractSummary, ValidationResult, WorkbookModel } from "@/lib/types";

const TEMP_ROOT = path.join(process.cwd(), "temp");
const UPLOADS_ROOT = path.join(TEMP_ROOT, "uploads");
const OUTPUT_ROOT = path.join(TEMP_ROOT, "output");
const DEFAULT_TEMPLATE_PATH = path.join(process.cwd(), "templates", "Book3.xlsx");
const PARSER_SCRIPT = path.join(process.cwd(), "scripts", "parser.py");
const PYTHON_BIN = process.env.PYTHON_BIN ?? "python3";

// Backstop for output directories nobody ever downloaded (browser closed
// mid-run, etc). There's no database to track "this is stale" — age of the
// directory itself is the only signal, and 1 hour is generous for a tool
// whose normal flow is "download within seconds of the run finishing."
const STALE_OUTPUT_MS = 60 * 60 * 1000;

export const OUTPUT_DIR_ROOT = OUTPUT_ROOT;

export interface UploadedFile {
  name: string;
  buffer: Buffer;
}

export interface ExtractInput {
  uploadedFiles: UploadedFile[]; // PDFs and/or a single ZIP
  customTemplate: UploadedFile | null; // null => use the built-in template
}

function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || "file";
}

async function sweepStaleOutputDirs(): Promise<void> {
  const entries = await readdir(OUTPUT_ROOT, { withFileTypes: true }).catch(() => []);
  const now = Date.now();

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(OUTPUT_ROOT, entry.name);
    const dirStat = await stat(dirPath).catch(() => null);
    if (dirStat && now - dirStat.mtimeMs > STALE_OUTPUT_MS) {
      await rm(dirPath, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

/**
 * Runs one full "Extract" batch: saves the upload to a scratch directory,
 * spawns scripts/parser.py once for the whole batch, and yields its NDJSON
 * events as they arrive (translating the parser's final "summary" event
 * into a "done" event carrying this run's download URLs).
 *
 * The upload directory is always removed afterwards, success or failure —
 * see the `finally` block. The *output* directory (the generated workbook
 * and, if any, errors.csv) is left for the download route to serve and
 * delete; see sweepStaleOutputDirs for the backstop if nobody downloads it.
 */
export async function* runExtract(input: ExtractInput): AsyncGenerator<ExtractEvent> {
  await mkdir(UPLOADS_ROOT, { recursive: true });
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await sweepStaleOutputDirs();

  const runId = randomUUID();
  const uploadDir = path.join(UPLOADS_ROOT, runId);
  const outputDir = path.join(OUTPUT_ROOT, runId);
  await mkdir(uploadDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  try {
    const inputPaths: string[] = [];
    for (const [index, file] of input.uploadedFiles.entries()) {
      const dir = path.join(uploadDir, String(index));
      await mkdir(dir, { recursive: true });
      const dest = path.join(dir, sanitizeFilename(file.name));
      await writeFile(dest, file.buffer);
      inputPaths.push(dest);
    }

    let templatePath = DEFAULT_TEMPLATE_PATH;
    if (input.customTemplate) {
      templatePath = path.join(uploadDir, sanitizeFilename(input.customTemplate.name));
      await writeFile(templatePath, input.customTemplate.buffer);
    }

    const manifest = {
      input_paths: inputPaths,
      extract_dir: path.join(uploadDir, "extracted"),
      template_path: templatePath,
      output_xlsx_path: path.join(outputDir, "workbook.xlsx"),
      errors_csv_path: path.join(outputDir, "errors.csv"),
      max_workers: process.env.PARSER_MAX_WORKERS ? Number(process.env.PARSER_MAX_WORKERS) : undefined,
    };
    const manifestPath = path.join(uploadDir, "manifest.json");
    await writeFile(manifestPath, JSON.stringify(manifest));

    const templateUsed = input.customTemplate ? "custom" : "default";
    yield* runParserProcess(manifestPath, runId, templateUsed);
  } finally {
    await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

interface ParserSummaryEvent {
  type: "summary";
  summary: ExtractSummary;
  hadErrors: boolean;
  workbook: WorkbookModel;
  validation: ValidationResult;
  newRowNumbers: number[];
}

async function* runParserProcess(
  manifestPath: string,
  runId: string,
  templateUsed: "default" | "custom"
): AsyncGenerator<ExtractEvent> {
  const child = spawn(PYTHON_BIN, [PARSER_SCRIPT, manifestPath]);

  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const rl = createInterface({ input: child.stdout });
  let sawTerminalEvent = false;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // ignore any stray non-JSON output on stdout
    }

    if (event.type === "summary") {
      sawTerminalEvent = true;
      const { summary, hadErrors, workbook, validation, newRowNumbers } = event as unknown as ParserSummaryEvent;
      yield {
        type: "done",
        summary,
        downloadUrl: `/api/download/${runId}/workbook.xlsx`,
        errorReportUrl: hadErrors ? `/api/download/${runId}/errors.csv` : null,
        templateUsed,
        workbook,
        validation,
        newRowNumbers,
      };
    } else if (event.type === "fatal" || event.type === "totals" || event.type === "file") {
      sawTerminalEvent = sawTerminalEvent || event.type === "fatal";
      yield event as unknown as ExtractEvent;
    }
  }

  const exitCode: number = await new Promise((resolve) => child.on("close", (code) => resolve(code ?? 1)));

  if (!sawTerminalEvent) {
    yield {
      type: "fatal",
      message:
        `Extraction process exited unexpectedly (code ${exitCode}).` +
        (stderr.trim() ? ` ${stderr.trim().slice(0, 2000)}` : ""),
    };
  }
}
