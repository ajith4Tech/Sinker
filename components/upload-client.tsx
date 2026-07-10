"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { FileDropZone } from "@/components/file-drop-zone";
import type {
  DoneEvent,
  ExtractEvent,
  ExtractSummary,
  FileProgressEvent,
  TotalsProgressEvent,
} from "@/lib/types";

const EMPTY_TOTALS: TotalsProgressEvent = {
  type: "totals",
  pdfsFound: 0,
  pdfsProcessed: 0,
  pdfsFailed: 0,
  rowsExtracted: 0,
  rowsAppended: 0,
  rowsSkipped: 0,
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function UploadClient() {
  const [files, setFiles] = useState<File[]>([]);
  const [templateMode, setTemplateMode] = useState<"default" | "custom">("default");
  const [customTemplate, setCustomTemplate] = useState<File[]>([]);

  const [extracting, setExtracting] = useState(false);
  const [totals, setTotals] = useState<TotalsProgressEvent>(EMPTY_TOTALS);
  const [lastFile, setLastFile] = useState<FileProgressEvent | null>(null);
  const [fileLog, setFileLog] = useState<FileProgressEvent[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<DoneEvent | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function handleExtract() {
    if (files.length === 0) return;

    setExtracting(true);
    setTotals(EMPTY_TOTALS);
    setLastFile(null);
    setFileLog([]);
    setResult(null);
    setElapsedMs(0);

    startRef.current = performance.now();
    timerRef.current = setInterval(() => setElapsedMs(performance.now() - startRef.current), 500);

    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (templateMode === "custom" && customTemplate[0]) {
      form.append("customTemplate", customTemplate[0]);
    }

    try {
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.body) {
        toast.error("Extraction failed to start.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as ExtractEvent;

          if (event.type === "totals") {
            setTotals(event);
          } else if (event.type === "file") {
            setLastFile(event);
            setFileLog((prev) => [event, ...prev]);
          } else if (event.type === "done") {
            setResult(event);
          } else if (event.type === "fatal") {
            toast.error(event.message);
          }
        }
      }
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setExtracting(false);
    }
  }

  const progressPct =
    totals.pdfsFound === 0 ? 0 : ((totals.pdfsProcessed + totals.pdfsFailed) / totals.pdfsFound) * 100;

  const canExtract = files.length > 0 && !extracting && (templateMode === "default" || customTemplate.length > 0);

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sinker</h1>
        <p className="text-sm text-muted-foreground">
          Extracts Shipping Bill PDFs and appends the data to an Excel workbook.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload PDFs / ZIP</CardTitle>
        </CardHeader>
        <CardContent>
          <FileDropZone
            files={files}
            onFilesChange={setFiles}
            accept=".pdf,.zip"
            label="Upload Shipping Bill PDFs or a ZIP of PDFs"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Excel Template</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="template-mode"
              checked={templateMode === "default"}
              onChange={() => setTemplateMode("default")}
            />
            Use built-in Excel template (default)
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="template-mode"
              checked={templateMode === "custom"}
              onChange={() => setTemplateMode("custom")}
            />
            Upload custom Excel template
          </label>

          {templateMode === "custom" && (
            <FileDropZone
              files={customTemplate}
              onFilesChange={(next) => setCustomTemplate(next.slice(-1))}
              accept=".xlsx"
              multiple={false}
              label="Upload your .xlsx template"
            />
          )}
        </CardContent>
      </Card>

      <Button size="lg" className="h-14 text-lg" disabled={!canExtract} onClick={handleExtract}>
        {extracting ? "Extracting…" : "Extract"}
      </Button>

      {(extracting || result) && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Progress</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <Progress value={progressPct} />

            <div className="grid grid-cols-3 gap-4 text-center sm:grid-cols-4">
              <Stat label="PDFs Found" value={totals.pdfsFound} />
              <Stat label="Processed" value={totals.pdfsProcessed} />
              <Stat label="Rows Appended" value={totals.rowsAppended} />
              <Stat label="Rows Skipped" value={totals.rowsSkipped} />
              <Stat label="Rows Extracted" value={totals.rowsExtracted} />
              <Stat label="Errors" value={totals.pdfsFailed} />
              <Stat label="Elapsed" value={formatElapsed(elapsedMs)} />
            </div>

            {lastFile && (
              <p className="truncate text-sm text-muted-foreground">
                Current PDF: <span className="font-medium text-foreground">{lastFile.filename}</span>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SummaryGrid summary={result.summary} />
            <div className="flex gap-2">
              <Button asChild>
                <a href={result.downloadUrl}>Download Updated Workbook</a>
              </Button>
              {result.errorReportUrl && (
                <Button variant="outline" asChild>
                  <a href={result.errorReportUrl}>Download Error Report</a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {fileLog.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Log</CardTitle>
          </CardHeader>
          <CardContent className="max-h-72 overflow-y-auto">
            <ul className="space-y-2 text-sm">
              {fileLog.map((entry, i) => (
                <li key={i} className="border-b py-1.5 last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{entry.filename}</span>
                    <span className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
                      {entry.status === "failed" ? (
                        <Badge variant="destructive">FAILED</Badge>
                      ) : (
                        <Badge variant="secondary">
                          {entry.rowsAppended} row{entry.rowsAppended === 1 ? "" : "s"}
                        </Badge>
                      )}
                      {entry.processingTimeMs}ms
                    </span>
                  </div>
                  {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}
                  {entry.warnings.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                      {entry.warnings.map((warning, w) => (
                        <li key={w}>{warning}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </main>
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

function SummaryGrid({ summary }: { summary: ExtractSummary }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <Stat label="Total PDFs" value={summary.totalPdfs} />
      <Stat label="Successful" value={summary.successfulPdfs} />
      <Stat label="Failed" value={summary.failedPdfs} />
      <Stat label="Rows Extracted" value={summary.rowsExtracted} />
      <Stat label="Rows Added" value={summary.rowsAppended} />
      <Stat label="Duplicates Skipped" value={summary.rowsSkipped} />
      <Stat label="Time" value={formatElapsed(summary.processingTimeMs)} />
    </div>
  );
}
