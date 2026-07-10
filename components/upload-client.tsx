"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileDropZone } from "@/components/file-drop-zone";
import { SummaryCard } from "@/components/SummaryCard";
import { DownloadPanel } from "@/components/DownloadPanel";
import { ExcelPreview } from "@/components/ExcelPreview";
import type { DoneEvent, ExtractEvent, FileProgressEvent, TotalsProgressEvent } from "@/lib/types";

const EMPTY_TOTALS: TotalsProgressEvent = {
  type: "totals",
  pdfsFound: 0,
  pdfsProcessed: 0,
  pdfsFailed: 0,
  rowsExtracted: 0,
  rowsAppended: 0,
  rowsSkipped: 0,
};

// The Processing Log is a chronological list of what happened, not a place
// to inspect extracted values — see the "system" variant for the plain
// start/finish/error lines, and "file" for one line per completed PDF
// (status/timing/error/warnings only — never the row data it produced).
type LogItem =
  | { kind: "system"; id: number; tone: "info" | "error"; message: string }
  | { kind: "file"; id: number; event: FileProgressEvent };

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
  const [logItems, setLogItems] = useState<LogItem[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [logOpen, setLogOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<DoneEvent | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);
  const logIdRef = useRef(0);

  // Lets the Log show "View PDF" for any directly-uploaded file, entirely
  // client-side — the browser already has these bytes, no server round trip.
  // Files that came from inside an uploaded ZIP aren't in this map (we never
  // unzip client-side), so those simply don't get a preview button.
  const previewUrls = useMemo(() => {
    const map = new Map<string, string>();
    for (const file of files) {
      map.set(file.name, URL.createObjectURL(file));
    }
    return map;
  }, [files]);

  useEffect(() => {
    return () => {
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [previewUrls]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function toggleExpanded(id: number) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function pushSystemLog(tone: "info" | "error", message: string) {
    setLogItems((prev) => [{ kind: "system", id: logIdRef.current++, tone, message }, ...prev]);
  }

  async function handleExtract() {
    if (files.length === 0) return;

    setExtracting(true);
    setTotals(EMPTY_TOTALS);
    setLastFile(null);
    setLogItems([]);
    setExpandedIds(new Set());
    setResult(null);
    setElapsedMs(0);
    logIdRef.current = 0;

    startRef.current = performance.now();
    timerRef.current = setInterval(() => setElapsedMs(performance.now() - startRef.current), 500);

    pushSystemLog("info", `Processing started — ${files.length} file${files.length === 1 ? "" : "s"} queued.`);

    const form = new FormData();
    files.forEach((file) => form.append("files", file));
    if (templateMode === "custom" && customTemplate[0]) {
      form.append("customTemplate", customTemplate[0]);
    }

    try {
      const res = await fetch("/api/extract", { method: "POST", body: form });
      if (!res.body) {
        toast.error("Extraction failed to start.");
        pushSystemLog("error", "Extraction failed to start.");
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
            setLogItems((prev) => [{ kind: "file", id: logIdRef.current++, event }, ...prev]);
          } else if (event.type === "done") {
            setResult(event);
            pushSystemLog(
              "info",
              `Extraction complete — ${event.summary.successfulPdfs} processed, ` +
                `${event.summary.failedPdfs} failed, ${event.summary.rowsAppended} row(s) added, ` +
                `${event.summary.rowsSkipped} duplicate(s) skipped.`
            );
          } else if (event.type === "fatal") {
            toast.error(event.message);
            pushSystemLog("error", event.message);
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
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sinker</h1>
        <p className="text-sm text-muted-foreground">
          Extracts Shipping Bill PDFs and appends the data to an Excel workbook.
        </p>
      </div>

      {/* 1. Upload PDFs / ZIP */}
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

      {/* 2. Template selection */}
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

      {/* 3. Extract button */}
      <Button size="lg" className="h-14 text-lg" disabled={!canExtract} onClick={handleExtract}>
        {extracting ? "Extracting…" : "Extract"}
      </Button>

      {/* 4. Progress */}
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

      {/* 5. Summary */}
      {result && <SummaryCard summary={result.summary} templateUsed={result.templateUsed} />}

      {/* 6. Excel Preview — the primary focus once extraction finishes */}
      {result && (
        <div className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Excel Preview</h2>
          {!result.validation.ok && (
            <p className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Validation found a mismatch between the parser output and the saved workbook — see the server log for
              details ({result.validation.incorrectFields.length} incorrect field(s),{" "}
              {result.validation.blankMandatoryFields.length} blank mandatory field(s),{" "}
              {result.validation.shiftedColumns.length} shifted column(s)).
            </p>
          )}
          <ExcelPreview workbook={result.workbook} newRowNumbers={result.newRowNumbers} />
        </div>
      )}

      {/* 7. Download */}
      {result && <DownloadPanel downloadUrl={result.downloadUrl} errorReportUrl={result.errorReportUrl} />}

      {/* 8. Processing Log — collapsed by default, never shows extracted values */}
      {logItems.length > 0 && (
        <Collapsible open={logOpen} onOpenChange={setLogOpen}>
          <Card>
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer select-none">
                <CardTitle className="flex items-center gap-2 text-base">
                  {logOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Processing Log
                  <span className="text-xs font-normal text-muted-foreground">({logItems.length})</span>
                </CardTitle>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="flex flex-col gap-1">
                {logItems.map((item) =>
                  item.kind === "system" ? (
                    <p
                      key={item.id}
                      className={
                        item.tone === "error"
                          ? "border-b py-1.5 text-sm text-destructive last:border-0"
                          : "border-b py-1.5 text-sm text-muted-foreground last:border-0"
                      }
                    >
                      {item.message}
                    </p>
                  ) : (
                    <LogRow
                      key={item.id}
                      entry={item.event}
                      expanded={expandedIds.has(item.id)}
                      onToggle={() => toggleExpanded(item.id)}
                      previewUrl={previewUrls.get(item.event.filename) ?? null}
                    />
                  )
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}
    </main>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
  previewUrl,
}: {
  entry: FileProgressEvent;
  expanded: boolean;
  onToggle: () => void;
  previewUrl: string | null;
}) {
  const hasDetails = Boolean(previewUrl) || Boolean(entry.error) || entry.warnings.length > 0;

  return (
    <div className="border-b py-1.5 last:border-0">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={hasDetails ? onToggle : undefined}
      >
        <span className="flex items-center gap-1 truncate font-medium">
          {hasDetails &&
            (expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            ))}
          {entry.filename}
        </span>
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
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-3 pl-5">
          {entry.error && <p className="text-xs text-destructive">{entry.error}</p>}

          {entry.warnings.length > 0 && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {entry.warnings.map((warning, w) => (
                <li key={w}>{warning}</li>
              ))}
            </ul>
          )}

          {previewUrl && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Uploaded PDF</p>
              <iframe src={previewUrl} title={entry.filename} className="h-72 w-full rounded border" />
            </div>
          )}
          {!previewUrl && (
            <p className="text-xs text-muted-foreground">
              (Preview unavailable — this file came from inside a ZIP.)
            </p>
          )}
        </div>
      )}
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
