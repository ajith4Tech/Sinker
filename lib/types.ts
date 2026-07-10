// Shared contract between the Next.js backend and scripts/parser.py — the
// NDJSON events printed to stdout while a batch runs, and the final summary.
//
// Mirrors scripts/models.py / scripts/template_schema.py / scripts/workbook_reader.py;
// when one changes, update the others.

/** One extracted line item as shown in the page's Log, without downloading anything. */
export interface ExtractedRow {
  portCode: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  exchangeRate: string | null;
  itemNo: string | null;
  hsnCode: string | null;
  productDescription: string | null;
  quantity: string | null;
  uqc: string | null;
  unitRate: string | null;
  itemValueFcy: string | null;
  dbkInvSno: string | null;
  dbkItemSno: string | null;
  dbkSno: string | null;
  dbkQtyWt: string | null;
  dbkValue: string | null;
  dbkRate: string | null;
  dbkAmt: string | null;
  dbkStalev: string | null;
  dbkCenlev: string | null;
  dbkRosctlAmt: string | null;
  rodtepInvsn: string | null;
  rodtepItmsn: string | null;
  rodtepQuantity: string | null;
  rodtepUqc: string | null;
  rodtepNoOfUnits: string | null;
  rodtepValue: string | null;
  appended: boolean;
  skippedReason: "duplicate" | "missing_key" | null;
}

/** File classification against data/state.json, computed before any parsing happens. */
export type FileClassification = "new" | "changed" | "unchanged";

/**
 * Emitted once, immediately after upload and file hashing, before any PDF is
 * parsed — lets the UI show "N new / M already processed / K changed"
 * ahead of the Progress section.
 */
export interface UploadSummaryEvent {
  type: "upload_summary";
  uploadedPdfs: number;
  newPdfs: number;
  alreadyProcessedPdfs: number;
  changedPdfs: number;
  files: Array<{ filename: string; classification: FileClassification }>;
}

/** Emitted right before a new/changed PDF is submitted for parsing (unchanged PDFs never get one — they go straight to "skipped"). */
export interface FileStartEvent {
  type: "file_start";
  filename: string;
}

/** One line per PDF as it finishes (or is skipped), streamed to the browser while a run is in progress. */
export interface FileProgressEvent {
  type: "file";
  filename: string;
  status: "processed" | "failed" | "skipped";
  classification: FileClassification;
  portCode: string | null;
  shippingBillNo: string | null;
  shippingBillDate: string | null;
  invoiceCount: number;
  rowsExtracted: number;
  rowsAppended: number;
  rowsSkipped: number;
  processingTimeMs: number;
  error: string | null;
  // Non-fatal notes from ShippingBillParser — e.g. "No Drawback claim rows
  // found." A file can be "processed" with 0 rows appended and still have
  // warnings explaining why nothing was extracted.
  warnings: string[];
  // Every line item found in this PDF — including ones skipped as
  // duplicates or for lacking a de-duplication key — so the page can show
  // exactly what was extracted without downloading the workbook.
  rows: ExtractedRow[];
}

/** Running totals, sent alongside each file event so the UI never has to sum client-side. */
export interface TotalsProgressEvent {
  type: "totals";
  pdfsFound: number;
  pdfsProcessed: number;
  pdfsFailed: number;
  pdfsSkipped: number;
  rowsExtracted: number;
  rowsAppended: number;
  rowsSkipped: number;
}

// ---------------------------------------------------------------------
// Workbook model — read back from the saved .xlsx with openpyxl
// (scripts/workbook_reader.py). This is the ONLY thing ExcelPreview
// renders; it is never derived from parser JSON, so it can't drift from
// what "Download Updated Excel" actually serves.
// ---------------------------------------------------------------------

export interface CellFontStyle {
  bold: boolean;
  italic: boolean;
  size: number | null;
  color: string | null;
  name: string | null;
}

export interface CellBorderSide {
  style: string;
  color: string | null;
}

export interface CellBorderStyle {
  top: CellBorderSide | null;
  bottom: CellBorderSide | null;
  left: CellBorderSide | null;
  right: CellBorderSide | null;
}

export interface CellAlignmentStyle {
  horizontal: string | null;
  vertical: string | null;
  wrapText: boolean;
}

export interface CellStyle {
  font: CellFontStyle;
  fill: { color: string | null };
  border: CellBorderStyle;
  alignment: CellAlignmentStyle;
  numberFormat: string;
}

export interface WorkbookCell {
  value: string | number | null;
  styleId: number;
}

export interface MergedRange {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export interface WorkbookModel {
  sheetName: string;
  maxRow: number;
  maxCol: number;
  columnWidths: number[]; // 0-indexed by column
  rowHeights: number[]; // 0-indexed by row
  merges: MergedRange[];
  freezePanes: string | null; // e.g. "A4"
  styles: CellStyle[];
  rows: WorkbookCell[][]; // rows[r][c], 0-indexed
}

export interface ValidationResult {
  ok: boolean;
  recordsChecked: number;
  incorrectFields: Array<{ field: string; cell: string; expected: unknown; actual: unknown; pdfSource: string | null }>;
  blankMandatoryFields: Array<{ field: string; cell: string; pdfSource: string | null }>;
  shiftedColumns: Array<{ column: number; expectedHeader: string | null; actualHeader: string | null }>;
}

export interface DoneEvent {
  type: "done";
  summary: ExtractSummary;
  downloadUrl: string;
  errorReportUrl: string | null;
  templateUsed: "default" | "custom" | "persistent";
  workbook: WorkbookModel;
  validation: ValidationResult;
  /** 1-indexed worksheet row numbers appended during this run (vs.
   * pre-existing in the template) — a UI highlighting affordance only, not
   * part of the workbook's own styling. */
  newRowNumbers: number[];
}

export interface FatalEvent {
  type: "fatal";
  message: string;
}

export type ExtractEvent =
  | UploadSummaryEvent
  | FileStartEvent
  | FileProgressEvent
  | TotalsProgressEvent
  | DoneEvent
  | FatalEvent;

export interface ExtractSummary {
  totalPdfs: number;
  successfulPdfs: number;
  failedPdfs: number;
  skippedPdfs: number;
  newPdfs: number;
  changedPdfs: number;
  rowsExtracted: number;
  rowsAppended: number;
  rowsSkipped: number;
  workbookTotalRows: number;
  processingTimeMs: number;
}

// ---------------------------------------------------------------------
// Statistics tab (GET /api/state) and Processing Log tab (GET /api/logs) —
// both read persisted JSON files verbatim, never recomputed from PDFs.
// ---------------------------------------------------------------------

export interface PersistedStats {
  totalPdfsProcessed: number;
  uniquePdfs: number;
  rowsExtracted: number;
  rowsAdded: number;
  duplicatesSkipped: number;
  failedPdfs: number;
  workbookTotalRows: number;
  averageRowsPerPdf: number;
  lastExtraction: string | null;
  lastProcessingTimeMs: number;
}

export type LogStatus = "Queued" | "Processing" | "Completed" | "Skipped" | "Failed";

export interface LogEntry {
  filename: string;
  status: LogStatus;
  rowsExtracted: number;
  rowsAdded: number;
  duplicatesSkipped: number;
  processingTimeMs: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}
