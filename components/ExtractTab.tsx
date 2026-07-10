"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { FileDropZone } from "@/components/file-drop-zone";
import { SummaryCard } from "@/components/SummaryCard";
import { UploadSummaryCard } from "@/components/UploadSummaryCard";
import type { DoneEvent, FileProgressEvent, TotalsProgressEvent, UploadSummaryEvent } from "@/lib/types";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function ExtractTab({
  files,
  onFilesChange,
  templateMode,
  onTemplateModeChange,
  customTemplate,
  onCustomTemplateChange,
  hasWorkbook,
  extracting,
  canExtract,
  onExtract,
  totals,
  lastFile,
  elapsedMs,
  uploadSummary,
  result,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
  templateMode: "default" | "custom";
  onTemplateModeChange: (mode: "default" | "custom") => void;
  customTemplate: File[];
  onCustomTemplateChange: (files: File[]) => void;
  hasWorkbook: boolean | null;
  extracting: boolean;
  canExtract: boolean;
  onExtract: () => void;
  totals: TotalsProgressEvent;
  lastFile: FileProgressEvent | null;
  elapsedMs: number;
  uploadSummary: UploadSummaryEvent | null;
  result: DoneEvent | null;
}) {
  const doneCount = totals.pdfsProcessed + totals.pdfsFailed + totals.pdfsSkipped;
  const progressPct = totals.pdfsFound === 0 ? 0 : (doneCount / totals.pdfsFound) * 100;
  const remainingCount = Math.max(0, totals.pdfsFound - doneCount);
  const estimatedRemainingMs = doneCount > 0 && remainingCount > 0 ? (elapsedMs / doneCount) * remainingCount : null;

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Upload PDFs / ZIP */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload PDFs / ZIP</CardTitle>
        </CardHeader>
        <CardContent>
          <FileDropZone
            files={files}
            onFilesChange={onFilesChange}
            accept=".pdf,.zip"
            label="Upload Shipping Bill PDFs or a ZIP of PDFs"
          />
        </CardContent>
      </Card>

      {/* 2. Template selection — only matters until the persistent workbook exists */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Excel Template</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {hasWorkbook ? (
            <p className="text-sm text-muted-foreground">
              A persistent workbook already exists (<code>data/workbook.xlsx</code>) — every extraction appends to
              it in place. Template selection only applies before the very first extraction.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="template-mode"
                  checked={templateMode === "default"}
                  onChange={() => onTemplateModeChange("default")}
                />
                Use built-in Excel template (default)
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="template-mode"
                  checked={templateMode === "custom"}
                  onChange={() => onTemplateModeChange("custom")}
                />
                Upload custom Excel template
              </label>

              {templateMode === "custom" && (
                <FileDropZone
                  files={customTemplate}
                  onFilesChange={(next) => onCustomTemplateChange(next.slice(-1))}
                  accept=".xlsx"
                  multiple={false}
                  label="Upload your .xlsx template"
                />
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* 3. Extract button */}
      <Button size="lg" className="h-14 text-lg" disabled={!canExtract} onClick={onExtract}>
        {extracting ? "Extracting…" : "Extract"}
      </Button>

      {/* Upload Summary — appears before extraction starts */}
      {uploadSummary && <UploadSummaryCard summary={uploadSummary} />}

      {/* Live Progress */}
      {(extracting || result) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={progressPct} />

            <div className="grid grid-cols-3 gap-4 text-center sm:grid-cols-4">
              <Stat label="File" value={`${doneCount} / ${totals.pdfsFound}`} />
              <Stat label="Rows Extracted" value={totals.rowsExtracted} />
              <Stat label="Rows Added" value={totals.rowsAppended} />
              <Stat label="Duplicate Rows Skipped" value={totals.rowsSkipped} />
              <Stat label="Errors" value={totals.pdfsFailed} />
              <Stat label="Overall Progress" value={`${Math.round(progressPct)}%`} />
              <Stat label="Elapsed" value={formatElapsed(elapsedMs)} />
              <Stat
                label="Est. Remaining"
                value={estimatedRemainingMs == null ? "—" : formatElapsed(estimatedRemainingMs)}
              />
            </div>

            {lastFile && (
              <p className="truncate text-sm text-muted-foreground">
                Current PDF: <span className="font-medium text-foreground">{lastFile.filename}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Post-Extraction Summary */}
      {result && <SummaryCard summary={result.summary} templateUsed={result.templateUsed} />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
