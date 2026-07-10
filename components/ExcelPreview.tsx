"use client";

import { useMemo, useRef, useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { WorksheetPreview, WorksheetRow } from "@/lib/types";

const ROW_HEIGHT = 33;
const ROW_NUMBER_WIDTH = 56;
const DEFAULT_COLUMN_WIDTH = 160;

/**
 * Renders the whole destination worksheet — read-only, client-side sort and
 * filter only (never touches the workbook file, never re-triggers a
 * download). Rows are windowed with @tanstack/react-virtual so this stays
 * smooth at 20,000+ rows; only rows currently scrolled into view are ever
 * mounted in the DOM.
 *
 * Deliberately not a literal <table>/<tr>/<td> — combining native table
 * layout with absolutely-positioned virtualized rows breaks column
 * alignment between the sticky header and body. This div/flex "grid" is
 * the pattern TanStack's own docs use for Virtual + Table together.
 */
export function ExcelPreview({ preview }: { preview: WorksheetPreview }) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns = useMemo<ColumnDef<WorksheetRow>[]>(
    () =>
      preview.columns.map((name, index) => ({
        id: `col-${index}`,
        header: name,
        accessorFn: (row: WorksheetRow) => row.values[index] ?? "",
        size: DEFAULT_COLUMN_WIDTH,
        filterFn: "includesString",
      })),
    [preview.columns]
  );

  const table = useReactTable({
    data: preview.rows,
    columns,
    state: { sorting, columnFilters, globalFilter },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const { rows } = table.getRowModel();

  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });
  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search all columns…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="max-w-xs"
        />
        <p className="whitespace-nowrap text-xs text-muted-foreground">
          Showing {rows.length.toLocaleString()} of {preview.rows.length.toLocaleString()} rows
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-200 dark:bg-green-900" /> new this session
          </span>
        </p>
      </div>

      <div ref={parentRef} className="h-[32rem] overflow-auto rounded border">
        <div style={{ width: table.getTotalSize() + ROW_NUMBER_WIDTH }}>
          {/* Header: column name + sort toggle + resize handle, and a filter input row */}
          <div className="sticky top-0 z-10 bg-card shadow-sm">
            <div className="flex">
              <div
                className="flex shrink-0 items-center border-b border-r px-2 py-1.5 text-xs font-semibold text-muted-foreground"
                style={{ width: ROW_NUMBER_WIDTH }}
              >
                #
              </div>
              {table.getFlatHeaders().map((header) => {
                const sorted = header.column.getIsSorted();
                return (
                  <div
                    key={header.id}
                    className="relative shrink-0 border-b border-r px-2 py-1.5"
                    style={{ width: header.getSize() }}
                  >
                    <button
                      className="flex w-full items-center gap-1 truncate text-left text-xs font-semibold"
                      onClick={header.column.getToggleSortingHandler()}
                      title={String(header.column.columnDef.header)}
                    >
                      <span className="truncate">{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      {sorted === "asc" && <ArrowUp className="h-3 w-3 shrink-0" />}
                      {sorted === "desc" && <ArrowDown className="h-3 w-3 shrink-0" />}
                      {!sorted && <ArrowUpDown className="h-3 w-3 shrink-0 text-muted-foreground/50" />}
                    </button>
                    <div
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize select-none touch-none hover:bg-primary/40"
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex">
              <div className="shrink-0 border-b border-r px-1 py-1" style={{ width: ROW_NUMBER_WIDTH }} />
              {table.getFlatHeaders().map((header) => (
                <div
                  key={header.id}
                  className="shrink-0 border-b border-r px-1 py-1"
                  style={{ width: header.getSize() }}
                >
                  <input
                    value={(header.column.getFilterValue() as string) ?? ""}
                    onChange={(e) => header.column.setFilterValue(e.target.value)}
                    placeholder="Filter…"
                    className="h-6 w-full rounded border bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Virtualized body */}
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const isNew = row.original.isNew;
              return (
                <div
                  key={row.id}
                  className={cn(
                    "absolute left-0 top-0 flex w-full border-b",
                    isNew ? "bg-green-50 dark:bg-green-950/40" : virtualRow.index % 2 === 1 ? "bg-muted/30" : ""
                  )}
                  style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <div
                    className="flex shrink-0 items-center border-r px-2 text-xs text-muted-foreground"
                    style={{ width: ROW_NUMBER_WIDTH }}
                  >
                    {row.original.rowNumber}
                  </div>
                  {row.getVisibleCells().map((cell) => (
                    <div
                      key={cell.id}
                      className="flex shrink-0 items-center truncate border-r px-2 text-xs"
                      style={{ width: cell.column.getSize() }}
                      title={String(cell.getValue() ?? "")}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
