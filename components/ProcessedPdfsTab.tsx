"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ProcessedPdfEntry, ProcessedPdfsSummary, ProcessedPdfStatus } from "@/lib/types";

const PAGE_SIZE = 100;

function statusVariant(status: ProcessedPdfStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Processed":
      return "default";
    case "Changed":
      return "outline";
    case "Skipped Duplicate":
      return "secondary";
    case "Failed":
      return "destructive";
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border p-4">
      <p className="text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

/**
 * Processed PDFs tab — full history of every PDF the batch has ever seen,
 * sourced from GET /api/processed-pdfs (data/logs.json + data/state.json).
 * `entries` is always what the server persisted, never in-memory
 * extraction state, so this survives a browser refresh or a server
 * restart same as the Processing Log / Statistics tabs.
 */
export function ProcessedPdfsTab({
  entries,
  summary,
  loading,
}: {
  entries: ProcessedPdfEntry[];
  summary: ProcessedPdfsSummary;
  loading: boolean;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return entries;
    return entries.filter((e) => e.filename.toLowerCase().includes(needle));
  }, [entries, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(0);
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <StatCard label="Total PDFs" value={summary.totalPdfs} />
            <StatCard label="Processed" value={summary.processed} />
            <StatCard label="Skipped" value={summary.skipped} />
            <StatCard label="Failed" value={summary.failed} />
            <StatCard label="Changed" value={summary.changed} />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search by filename…"
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="max-w-xs"
        />
        <p className="whitespace-nowrap text-xs text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length.toLocaleString()} PDF${filtered.length === 1 ? "" : "s"}`}
        </p>
      </div>

      <div className="max-h-[32rem] overflow-auto rounded border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 text-left text-xs uppercase text-muted-foreground backdrop-blur">
            <tr>
              <th className="border-b px-3 py-2 font-medium">File Name</th>
              <th className="border-b px-3 py-2 font-medium">Status</th>
              <th className="border-b px-3 py-2 font-medium">Rows Extracted</th>
              <th className="border-b px-3 py-2 font-medium">New Rows Added</th>
              <th className="border-b px-3 py-2 font-medium">Duplicate Rows Skipped</th>
              <th className="border-b px-3 py-2 font-medium">File SHA256</th>
              <th className="border-b px-3 py-2 font-medium">Processed Time</th>
              <th className="border-b px-3 py-2 font-medium">Last Modified</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr key={`${row.filename}-${row.processedAt}-${i}`} className="border-b last:border-b-0">
                <td className="max-w-[16rem] truncate px-3 py-2 font-medium" title={row.filename}>
                  {row.filename}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.rowsExtracted}</td>
                <td className="px-3 py-2 tabular-nums">{row.rowsAdded}</td>
                <td className="px-3 py-2 tabular-nums">{row.duplicatesSkipped}</td>
                <td className="max-w-[10rem] truncate px-3 py-2 font-mono text-xs text-muted-foreground" title={row.sha256 ?? undefined}>
                  {row.sha256 ?? "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatTimestamp(row.processedAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatTimestamp(row.lastModified)}
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                  No processed PDFs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Page {safePage + 1} of {pageCount}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={safePage >= pageCount - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
