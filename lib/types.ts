// Shared contract between the Next.js backend and scripts/parser.py — the
// NDJSON events printed to stdout while a batch runs, and the final summary.
//
// Mirrors scripts/models.py; when one changes, update the other.

export interface ExtractLineItem {
  itemNumber: string | null;
  hsCode: string | null;
  description: string | null;
  quantity: string | null;
  uqc: string | null;
  rate: string | null;
  fob: string | null;
  invoiceValue: string | null;
  drawback: string | null;
  rodtep: string | null;
}

export interface ShippingBillResult {
  shippingBill: string | null;
  shippingBillDate: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  iec: string | null;
  gstin: string | null;
  portCode: string | null;
  exchangeRate: string | null;
  items: ExtractLineItem[];
  warnings: string[];
}

/** One line per PDF as it finishes, streamed to the browser while a run is in progress. */
export interface FileProgressEvent {
  type: "file";
  filename: string;
  status: "processed" | "failed";
  shippingBill: string | null;
  rowsAppended: number;
  rowsSkipped: number;
  processingTimeMs: number;
  error: string | null;
}

/** Running totals, sent alongside each file event so the UI never has to sum client-side. */
export interface TotalsProgressEvent {
  type: "totals";
  pdfsFound: number;
  pdfsProcessed: number;
  pdfsFailed: number;
  rowsExtracted: number;
  rowsAppended: number;
  rowsSkipped: number;
}

export interface DoneEvent {
  type: "done";
  summary: ExtractSummary;
  downloadUrl: string;
  errorReportUrl: string | null;
}

export interface FatalEvent {
  type: "fatal";
  message: string;
}

export type ExtractEvent = FileProgressEvent | TotalsProgressEvent | DoneEvent | FatalEvent;

export interface ExtractSummary {
  totalPdfs: number;
  successfulPdfs: number;
  failedPdfs: number;
  rowsExtracted: number;
  rowsAppended: number;
  rowsSkipped: number;
  processingTimeMs: number;
}
