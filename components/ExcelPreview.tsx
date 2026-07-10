"use client";

import { useMemo, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  themeQuartz,
  type ColDef,
  type RowClassRules,
} from "ag-grid-community";
import { Input } from "@/components/ui/input";
import type { WorksheetPreview } from "@/lib/types";

ModuleRegistry.registerModules([AllCommunityModule]);

interface GridRow {
  rowNumber: number;
  isNew: boolean;
  [key: `col${number}`]: string | null;
}

/**
 * Renders the whole destination worksheet — read-only, client-side sort,
 * filter, and search only (this component never writes back to the
 * workbook, and never triggers a download). AG Grid Community handles row
 * virtualization natively, so this stays smooth whether the sheet has 50
 * rows or 50,000 — only rows scrolled into view are ever in the DOM.
 *
 * rowData/columnDefs are a direct mapping of WorksheetPreview (itself a
 * direct dump of the real openpyxl worksheet from ExcelWriter.to_preview())
 * — not a separately-constructed table model, so the preview can't drift
 * from what "Download Updated Excel" actually serves.
 */
export function ExcelPreview({ preview }: { preview: WorksheetPreview }) {
  const [quickFilter, setQuickFilter] = useState("");

  const rowData = useMemo<GridRow[]>(
    () =>
      preview.rows.map((row) => {
        const record: GridRow = { rowNumber: row.rowNumber, isNew: row.isNew };
        row.values.forEach((value, i) => {
          record[`col${i}`] = value;
        });
        return record;
      }),
    [preview]
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const rowNumberCol: ColDef = {
      headerName: "#",
      field: "rowNumber",
      pinned: "left",
      width: 56,
      sortable: false,
      filter: false,
      resizable: false,
      cellClass: "text-muted-foreground",
    };
    const dataCols: ColDef[] = preview.columns.map((name, i) => ({
      headerName: name,
      field: `col${i}`,
    }));
    return [rowNumberCol, ...dataCols];
  }, [preview.columns]);

  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      filter: "agTextColumnFilter",
      resizable: true,
      minWidth: 130,
    }),
    []
  );

  const rowClassRules = useMemo<RowClassRules<GridRow>>(
    () => ({
      "row-new": (params) => Boolean(params.data?.isNew),
      "row-odd": (params) => (params.node?.rowIndex ?? 0) % 2 === 1,
    }),
    []
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Search all columns…"
          value={quickFilter}
          onChange={(e) => setQuickFilter(e.target.value)}
          className="max-w-xs"
        />
        <p className="whitespace-nowrap text-xs text-muted-foreground">
          {preview.rows.length.toLocaleString()} row{preview.rows.length === 1 ? "" : "s"}
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-200 dark:bg-green-900" /> new this session
          </span>
        </p>
      </div>

      <div className="h-[32rem] overflow-hidden rounded border">
        <AgGridReact<GridRow>
          theme={themeQuartz}
          rowData={rowData}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowClassRules={rowClassRules}
          quickFilterText={quickFilter}
          rowHeight={32}
          headerHeight={32}
          suppressCellFocus
        />
      </div>
    </div>
  );
}
