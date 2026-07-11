"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ExtractTab } from "@/components/ExtractTab";
import { ExcelPreview } from "@/components/ExcelPreview";
import { DownloadPanel } from "@/components/DownloadPanel";
import { StatisticsTab } from "@/components/StatisticsTab";
import { ProcessingLogTab } from "@/components/ProcessingLogTab";
import { ProcessedPdfsTab } from "@/components/ProcessedPdfsTab";
import { ErrorsTab, ErrorsTabTrigger } from "@/components/ErrorsTab";
import type {
  DoneEvent,
  ExtractEvent,
  FileProgressEvent,
  LogEntry,
  PersistedStats,
  ProcessedPdfEntry,
  ProcessedPdfsSummary,
  TotalsProgressEvent,
  UploadSummaryEvent,
  WorkbookPreviewResponse,
} from "@/lib/types";

const EMPTY_TOTALS: TotalsProgressEvent = {
  type: "totals",
  pdfsFound: 0,
  pdfsProcessed: 0,
  pdfsFailed: 0,
  pdfsSkipped: 0,
  rowsExtracted: 0,
  rowsAppended: 0,
  rowsSkipped: 0,
};

const EMPTY_STATS: PersistedStats = {
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

const EMPTY_PROCESSED_SUMMARY: ProcessedPdfsSummary = {
  totalPdfs: 0,
  processed: 0,
  skipped: 0,
  failed: 0,
  changed: 0,
};

function emptyLogRow(filename: string): LogEntry {
  return {
    filename,
    status: "Queued",
    rowsExtracted: 0,
    rowsAdded: 0,
    duplicatesSkipped: 0,
    processingTimeMs: 0,
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

export function SinkerApp() {
  const [files, setFiles] = useState<File[]>([]);
  const [templateMode, setTemplateMode] = useState<"default" | "custom">("default");
  const [customTemplate, setCustomTemplate] = useState<File[]>([]);

  const [extracting, setExtracting] = useState(false);
  const [totals, setTotals] = useState<TotalsProgressEvent>(EMPTY_TOTALS);
  const [lastFile, setLastFile] = useState<FileProgressEvent | null>(null);
  const [uploadSummary, setUploadSummary] = useState<UploadSummaryEvent | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [result, setResult] = useState<DoneEvent | null>(null);

  const [liveLogMap, setLiveLogMap] = useState<Map<string, LogEntry>>(new Map());
  const [persistedLogs, setPersistedLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [stats, setStats] = useState<PersistedStats>(EMPTY_STATS);
  const [statsLoading, setStatsLoading] = useState(true);
  const [hasWorkbook, setHasWorkbook] = useState<boolean | null>(null);

  const [processedPdfs, setProcessedPdfs] = useState<ProcessedPdfEntry[]>([]);
  const [processedPdfsSummary, setProcessedPdfsSummary] = useState<ProcessedPdfsSummary>(EMPTY_PROCESSED_SUMMARY);
  const [processedPdfsLoading, setProcessedPdfsLoading] = useState(true);

  const [workbookPreview, setWorkbookPreview] = useState<WorkbookPreviewResponse | null>(null);
  const [workbookPreviewLoading, setWorkbookPreviewLoading] = useState(true);

  const [activeTab, setActiveTab] = useState("extract");

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startRef = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  async function refreshPersisted() {
    setLogsLoading(true);
    setStatsLoading(true);
    setProcessedPdfsLoading(true);
    setWorkbookPreviewLoading(true);
    try {
      const [logsRes, stateRes, processedRes, previewRes] = await Promise.all([
        fetch("/api/logs"),
        fetch("/api/state"),
        fetch("/api/processed-pdfs"),
        fetch("/api/workbook-preview"),
      ]);
      const logsData = await logsRes.json();
      const stateData = await stateRes.json();
      const processedData = await processedRes.json();
      const previewData = await previewRes.json();
      setPersistedLogs(Array.isArray(logsData.logs) ? logsData.logs : []);
      setStats({ ...EMPTY_STATS, ...stateData.stats });
      setHasWorkbook(Boolean(stateData.hasWorkbook));
      setProcessedPdfs(Array.isArray(processedData.entries) ? processedData.entries : []);
      setProcessedPdfsSummary({ ...EMPTY_PROCESSED_SUMMARY, ...processedData.summary });
      setWorkbookPreview(previewData.workbook ? previewData : null);
    } finally {
      setLogsLoading(false);
      setStatsLoading(false);
      setProcessedPdfsLoading(false);
      setWorkbookPreviewLoading(false);
    }
  }

  // Loads persisted history/stats/workbook preview once on page load —
  // Statistics, Processing Log, Processed PDFs, and Excel Preview must all
  // survive a refresh or a server restart, so they're seeded from the
  // server here, never from in-memory state that a reload would wipe.
  useEffect(() => {
    refreshPersisted();
  }, []);

  async function handleExtract() {
    if (files.length === 0) return;

    setExtracting(true);
    setTotals(EMPTY_TOTALS);
    setLastFile(null);
    setUploadSummary(null);
    setLiveLogMap(new Map());
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

          if (event.type === "upload_summary") {
            setUploadSummary(event);
            const seeded = new Map<string, LogEntry>();
            for (const f of event.files) seeded.set(f.filename, emptyLogRow(f.filename));
            setLiveLogMap(seeded);
          } else if (event.type === "file_start") {
            setLiveLogMap((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.filename) ?? emptyLogRow(event.filename);
              next.set(event.filename, { ...existing, status: "Processing", startedAt: new Date().toISOString() });
              return next;
            });
          } else if (event.type === "totals") {
            setTotals(event);
          } else if (event.type === "file") {
            setLastFile(event);
            setLiveLogMap((prev) => {
              const next = new Map(prev);
              const existing = next.get(event.filename) ?? emptyLogRow(event.filename);
              next.set(event.filename, {
                ...existing,
                status: event.status === "processed" ? "Completed" : event.status === "skipped" ? "Skipped" : "Failed",
                rowsExtracted: event.rowsExtracted,
                rowsAdded: event.rowsAppended,
                duplicatesSkipped: event.rowsSkipped,
                processingTimeMs: event.processingTimeMs,
                completedAt: new Date().toISOString(),
                error: event.error,
              });
              return next;
            });
          } else if (event.type === "done") {
            setResult(event);
            setLiveLogMap(new Map());
            await refreshPersisted();
            toast.success(
              `Extraction complete — ${event.summary.successfulPdfs} processed, ${event.summary.skippedPdfs} skipped, ` +
                `${event.summary.failedPdfs} failed, ${event.summary.rowsAppended} row(s) added.`
            );
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

  const liveLogRows = useMemo(() => Array.from(liveLogMap.values()), [liveLogMap]);
  const failedEntries = useMemo(() => persistedLogs.filter((l) => l.status === "Failed"), [persistedLogs]);
  const hasFailures = failedEntries.length > 0 || totals.pdfsFailed > 0;

  const canExtract = files.length > 0 && !extracting && (templateMode === "default" || customTemplate.length > 0);

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sinker</h1>
        <p className="text-sm text-muted-foreground">
          Extracts Shipping Bill PDFs and appends the data to a persistent Excel workbook.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="extract">Extract</TabsTrigger>
          <TabsTrigger value="preview">Excel Preview</TabsTrigger>
          <TabsTrigger value="stats">Statistics</TabsTrigger>
          <TabsTrigger value="processed">Processed PDFs</TabsTrigger>
          <TabsTrigger value="log">Processing Log</TabsTrigger>
          {hasFailures && (
            <TabsTrigger value="errors">
              <ErrorsTabTrigger count={failedEntries.length || totals.pdfsFailed} />
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="extract" className="pt-6">
          <ExtractTab
            files={files}
            onFilesChange={setFiles}
            templateMode={templateMode}
            onTemplateModeChange={setTemplateMode}
            customTemplate={customTemplate}
            onCustomTemplateChange={setCustomTemplate}
            hasWorkbook={hasWorkbook}
            extracting={extracting}
            canExtract={canExtract}
            onExtract={handleExtract}
            totals={totals}
            lastFile={lastFile}
            elapsedMs={elapsedMs}
            uploadSummary={uploadSummary}
            result={result}
          />
        </TabsContent>

        <TabsContent value="preview" className="flex flex-col gap-3 pt-6">
          {result && !result.validation.ok && (
            <p className="rounded border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Validation found a mismatch between the parser output and the saved workbook — see the server log for
              details ({result.validation.incorrectFields.length} incorrect field(s),{" "}
              {result.validation.blankMandatoryFields.length} blank mandatory field(s),{" "}
              {result.validation.shiftedColumns.length} shifted column(s)).
            </p>
          )}
          {workbookPreviewLoading && !workbookPreview ? (
            <p className="text-sm text-muted-foreground">Loading workbook preview…</p>
          ) : workbookPreview ? (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={refreshPersisted}>
                  Refresh
                </Button>
              </div>
              <ExcelPreview
                workbook={workbookPreview.workbook}
                newRowNumbers={result?.newRowNumbers ?? []}
                updatedAt={workbookPreview.updatedAt}
              />
              <DownloadPanel downloadUrl="/api/download/workbook" errorReportUrl={result?.errorReportUrl ?? null} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Run an extraction to preview the workbook.</p>
          )}
        </TabsContent>

        <TabsContent value="stats" className="pt-6">
          <StatisticsTab stats={stats} loading={statsLoading} />
        </TabsContent>

        <TabsContent value="processed" className="pt-6">
          <ProcessedPdfsTab entries={processedPdfs} summary={processedPdfsSummary} loading={processedPdfsLoading} />
        </TabsContent>

        <TabsContent value="log" className="pt-6">
          <ProcessingLogTab liveRows={liveLogRows} persistedRows={persistedLogs} loading={logsLoading} />
        </TabsContent>

        {hasFailures && (
          <TabsContent value="errors" className="pt-6">
            <ErrorsTab entries={failedEntries} />
          </TabsContent>
        )}
      </Tabs>
    </main>
  );
}
