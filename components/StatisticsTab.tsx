import { Card, CardContent } from "@/components/ui/card";
import type { PersistedStats } from "@/lib/types";

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * Purely presentational — `stats` is data/state.json's own cumulative
 * `stats` block (see SinkerApp, which loads it via GET /api/state). Never
 * opens a PDF, never re-reads the workbook; loads instantly and persists
 * across a page refresh because it lives in a file, not component state.
 */
export function StatisticsTab({ stats, loading }: { stats: PersistedStats; loading: boolean }) {
  return (
    <Card>
      <CardContent className="pt-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading statistics…</p>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
            <StatCard label="Total PDFs Processed" value={stats.totalPdfsProcessed} />
            <StatCard label="Unique PDFs" value={stats.uniquePdfs} />
            <StatCard label="Rows Extracted" value={stats.rowsExtracted} />
            <StatCard label="Rows Added" value={stats.rowsAdded} />
            <StatCard label="Duplicate Rows Skipped" value={stats.duplicatesSkipped} />
            <StatCard label="Failed PDFs" value={stats.failedPdfs} />
            <StatCard label="Workbook Total Rows" value={stats.workbookTotalRows} />
            <StatCard label="Average Rows per PDF" value={stats.averageRowsPerPdf} />
            <StatCard label="Last Extraction" value={formatTimestamp(stats.lastExtraction)} />
            <StatCard label="Last Processing Time" value={formatElapsed(stats.lastProcessingTimeMs)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border p-4">
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
