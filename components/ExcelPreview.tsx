"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { Input } from "@/components/ui/input";
import type { CellBorderSide, CellStyle, WorkbookModel } from "@/lib/types";

/**
 * Renders the actual saved workbook — read cell-by-cell (value, font, fill,
 * border, alignment, merges, row heights, column widths) from
 * scripts/workbook_reader.py's openpyxl model. This component never
 * receives parser JSON; if it's on screen, it came from opening the .xlsx
 * file that "Download Updated Excel" serves. CSS Grid (not a <table>) so
 * merged header cells, exact row/column sizing, and per-cell borders all
 * render pixel-for-pixel instead of an approximation.
 */
export function ExcelPreview({
  workbook,
  newRowNumbers = [],
}: {
  workbook: WorkbookModel;
  newRowNumbers?: number[];
}) {
  const [quickFilter, setQuickFilter] = useState("");

  const freezeRow = useMemo(() => parseFreezeRow(workbook.freezePanes), [workbook.freezePanes]);
  const headerRowCount = freezeRow ? freezeRow - 1 : 0;

  const newRowSet = useMemo(() => new Set(newRowNumbers), [newRowNumbers]);

  // Merges are confined to the header band in this template — data rows
  // never merge — so filtering data rows can never split a merged region.
  const merges = workbook.merges;
  const coveredCells = useMemo(() => {
    const set = new Set<string>();
    for (const m of merges) {
      for (let r = m.minRow; r <= m.maxRow; r++) {
        for (let c = m.minCol; c <= m.maxCol; c++) {
          if (r === m.minRow && c === m.minCol) continue;
          set.add(`${r}:${c}`);
        }
      }
    }
    return set;
  }, [merges]);

  const mergeAt = useMemo(() => {
    const map = new Map<string, (typeof merges)[number]>();
    for (const m of merges) map.set(`${m.minRow}:${m.minCol}`, m);
    return map;
  }, [merges]);

  const needle = quickFilter.trim().toLowerCase();
  const visibleDataRowNumbers = useMemo(() => {
    const rowNumbers: number[] = [];
    for (let r = headerRowCount + 1; r <= workbook.maxRow; r++) {
      if (!needle) {
        rowNumbers.push(r);
        continue;
      }
      const rowCells = workbook.rows[r - 1] ?? [];
      const matches = rowCells.some((cell) => String(cell.value ?? "").toLowerCase().includes(needle));
      if (matches) rowNumbers.push(r);
    }
    return rowNumbers;
  }, [workbook, headerRowCount, needle]);

  // Logical grid row per worksheet row number: header rows keep their real
  // row number (1..headerRowCount); each visible data row gets the next
  // sequential slot, so filtering never leaves gaps in the CSS grid.
  const gridRowOf = useMemo(() => {
    const map = new Map<number, number>();
    for (let r = 1; r <= headerRowCount; r++) map.set(r, r);
    visibleDataRowNumbers.forEach((rowNum, i) => map.set(rowNum, headerRowCount + 1 + i));
    return map;
  }, [headerRowCount, visibleDataRowNumbers]);

  const totalGridRows = headerRowCount + visibleDataRowNumbers.length;

  const columnTemplate = workbook.columnWidths.map((w) => `${colWidthPx(w)}px`).join(" ");
  const rowTemplate = useMemo(() => {
    const heights: string[] = [];
    for (let r = 1; r <= headerRowCount; r++) heights.push(`${rowHeightPx(workbook.rowHeights[r - 1])}px`);
    for (const r of visibleDataRowNumbers) heights.push(`${rowHeightPx(workbook.rowHeights[r - 1])}px`);
    return heights.join(" ");
  }, [workbook, headerRowCount, visibleDataRowNumbers]);

  const headerHeightPx = useMemo(() => {
    let total = 0;
    for (let r = 1; r <= headerRowCount; r++) total += rowHeightPx(workbook.rowHeights[r - 1]);
    return total;
  }, [workbook, headerRowCount]);

  const cellsToRender: Array<{
    key: string;
    rowNum: number;
    colNum: number;
    rowSpan: number;
    colSpan: number;
    value: string | number | null;
    style: CellStyle;
    isNew: boolean;
    isHeader: boolean;
  }> = [];

  const rowNumbersToRender = [
    ...Array.from({ length: headerRowCount }, (_, i) => i + 1),
    ...visibleDataRowNumbers,
  ];

  for (const rowNum of rowNumbersToRender) {
    const rowCells = workbook.rows[rowNum - 1] ?? [];
    for (let colNum = 1; colNum <= workbook.maxCol; colNum++) {
      if (coveredCells.has(`${rowNum}:${colNum}`)) continue;

      const cell = rowCells[colNum - 1];
      if (!cell) continue;

      const merge = mergeAt.get(`${rowNum}:${colNum}`);
      const rowSpan = merge ? merge.maxRow - merge.minRow + 1 : 1;
      const colSpan = merge ? merge.maxCol - merge.minCol + 1 : 1;

      cellsToRender.push({
        key: `${rowNum}:${colNum}`,
        rowNum: gridRowOf.get(rowNum) ?? rowNum,
        colNum,
        rowSpan,
        colSpan,
        value: cell.value,
        style: workbook.styles[cell.styleId],
        isNew: newRowSet.has(rowNum) && rowNum > headerRowCount,
        isHeader: rowNum <= headerRowCount,
      });
    }
  }

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
          {visibleDataRowNumbers.length.toLocaleString()} row{visibleDataRowNumbers.length === 1 ? "" : "s"}
          <span className="ml-2 inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-green-200 dark:bg-green-900" /> new this session
          </span>
        </p>
      </div>

      <div className="h-[32rem] overflow-auto rounded border bg-white dark:bg-neutral-950">
        <div
          className="grid"
          style={{
            gridTemplateColumns: columnTemplate,
            gridTemplateRows: rowTemplate,
            width: "max-content",
          }}
        >
          {cellsToRender.map((c) => (
            <div
              key={c.key}
              style={{
                gridColumn: `${c.colNum} / span ${c.colSpan}`,
                gridRow: `${c.rowNum} / span ${c.rowSpan}`,
                position: c.isHeader ? "sticky" : undefined,
                top: c.isHeader ? headerRowTop(workbook, c.rowNum) : undefined,
                zIndex: c.isHeader ? 10 : undefined,
                ...styleToCss(c.style),
                ...(c.isNew ? { boxShadow: "inset 0 0 0 9999px rgba(34,197,94,0.15)" } : {}),
              }}
              title={c.value != null ? String(c.value) : undefined}
            >
              {formatValue(c.value)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function parseFreezeRow(freezePanes: string | null): number | null {
  if (!freezePanes) return null;
  const m = /^[A-Z]+(\d+)$/.exec(freezePanes);
  return m ? Number(m[1]) : null;
}

function colWidthPx(excelWidth: number): number {
  return Math.max(24, Math.round(excelWidth * 7 + 5));
}

function rowHeightPx(points: number): number {
  return Math.max(16, Math.round(points * (96 / 72)));
}

function headerRowTop(workbook: WorkbookModel, rowNum: number): number {
  let top = 0;
  for (let r = 1; r < rowNum; r++) top += rowHeightPx(workbook.rowHeights[r - 1]);
  return top;
}

function formatValue(value: string | number | null): string {
  if (value == null) return "";
  return String(value);
}

function borderCss(side: CellBorderSide | null): string {
  if (!side) return "1px solid transparent";
  const width = side.style === "thick" ? "2.5px" : side.style === "medium" ? "1.5px" : "1px";
  const styleWord = side.style === "dashed" ? "dashed" : side.style === "dotted" ? "dotted" : "solid";
  const color = side.color ? toCssColor(side.color) : "#94a3b8";
  return `${width} ${styleWord} ${color}`;
}

function toCssColor(argbOrRgb: string): string {
  const hex = argbOrRgb.length === 8 ? argbOrRgb.slice(2) : argbOrRgb;
  return `#${hex}`;
}

function styleToCss(style: CellStyle | undefined): CSSProperties {
  if (!style) return {};
  const justify =
    style.alignment.horizontal === "right"
      ? "flex-end"
      : style.alignment.horizontal === "center"
        ? "center"
        : "flex-start";
  const align =
    style.alignment.vertical === "center"
      ? "center"
      : style.alignment.vertical === "bottom"
        ? "flex-end"
        : "flex-start";

  return {
    display: "flex",
    alignItems: align,
    justifyContent: justify,
    padding: "2px 6px",
    fontWeight: style.font.bold ? 700 : 400,
    fontStyle: style.font.italic ? "italic" : "normal",
    fontSize: style.font.size ? `${style.font.size}px` : "12px",
    color: style.font.color ? toCssColor(style.font.color) : undefined,
    backgroundColor: style.fill.color ? toCssColor(style.fill.color) : undefined,
    borderTop: borderCss(style.border.top),
    borderBottom: borderCss(style.border.bottom),
    borderLeft: borderCss(style.border.left),
    borderRight: borderCss(style.border.right),
    whiteSpace: style.alignment.wrapText ? "pre-wrap" : "nowrap",
    overflow: "hidden",
    textOverflow: style.alignment.wrapText ? "clip" : "ellipsis",
    wordBreak: style.alignment.wrapText ? "break-word" : undefined,
  };
}
