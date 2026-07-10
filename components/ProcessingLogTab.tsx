"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { LogEntry, LogStatus } from "@/lib/types";

function statusVariant(status: LogStatus): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Completed":
      return "default";
    case "Failed":
      return "destructive";
    case "Skipped":
      return "secondary";
    default:
      return "outline";
  }
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

/**
 * Full processing history, moved off the main page into its own tab.
 * `persistedRows` come from data/logs.json (see SinkerApp's GET /api/logs)
 * so they survive a refresh; `liveRows` (this run's in-flight
 * Queued/Processing/Completed rows) are laid on top while a run is active
 * and drop away once it finishes and the persisted list has been refetched.
 */
export function ProcessingLogTab({
  liveRows,
  persistedRows,
  loading,
}: {
  liveRows: LogEntry[];
  persistedRows: LogEntry[];
  loading: boolean;
}) {
  const [search, setSearch] = useState("");

  const rows = useMemo(() => [...liveRows, ...[...persistedRows].reverse()], [liveRows, persistedRows]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      [row.filename, row.status, row.error ?? ""].some((v) => v.toLowerCase().includes(needle))
    );
  }, [rows, search]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search filename, status, or error…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <p className="text-xs text-muted-foreground">
          {loading ? "Loading…" : `${filtered.length.toLocaleString()} entr${filtered.length === 1 ? "y" : "ies"}`}
        </p>
      </div>

      <div className="overflow-x-auto rounded border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Filename</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Rows Extracted</th>
              <th className="px-3 py-2 font-medium">Rows Added</th>
              <th className="px-3 py-2 font-medium">Duplicates Skipped</th>
              <th className="px-3 py-2 font-medium">Processing Time</th>
              <th className="px-3 py-2 font-medium">Started At</th>
              <th className="px-3 py-2 font-medium">Completed At</th>
              <th className="px-3 py-2 font-medium">Error</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row, i) => (
              <tr key={`${row.filename}-${row.startedAt}-${i}`} className="border-t">
                <td className="max-w-[16rem] truncate px-3 py-2 font-medium" title={row.filename}>
                  {row.filename}
                </td>
                <td className="px-3 py-2">
                  <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                </td>
                <td className="px-3 py-2 tabular-nums">{row.rowsExtracted}</td>
                <td className="px-3 py-2 tabular-nums">{row.rowsAdded}</td>
                <td className="px-3 py-2 tabular-nums">{row.duplicatesSkipped}</td>
                <td className="px-3 py-2 tabular-nums">{row.processingTimeMs}ms</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatTimestamp(row.startedAt)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                  {formatTimestamp(row.completedAt)}
                </td>
                <td className="max-w-[20rem] truncate px-3 py-2 text-destructive" title={row.error ?? undefined}>
                  {row.error ?? ""}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">
                  No processing history yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
